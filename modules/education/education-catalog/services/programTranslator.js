// server/modules/education/education-catalog/services/programTranslator.js
//
// Перевод названия и описания теста на остальные языки.
//
// ЗАЧЕМ ЭТО ПОНАДОБИЛОСЬ. Вопросы банка переводились уже давно (education-
// translation: публикация вопроса ставит перевод в очередь), а сам тест —
// нет. Из-за этого каталог был вынужден пришпиливать тест к ОДНОМУ языку
// (primaryLang): врач, выбравший азербайджанский, иначе получил бы карточку
// «Типология личности по Карлу Юнгу» с русским заголовком — тест на его
// языке существует, но прочитать в списке его нельзя.
//
// Как только у теста появляется название на пяти языках, причина исчезает:
// один тест — одна карточка, читаемая на языке врача, и виден он везде, где
// у него есть вопросы. Ровно это и делает витрину «на всех языках».
//
// УСТРОЕН КАК ПЕРЕВОД РУБРИКИ, а не как перевод вопроса. Название и описание
// теста — короткий текст без дозировок и отрицаний: один вызов на все языки
// сразу, без адаптивного мышления. У вопроса наоборот — по языку за вызов и
// с раздумьями, потому что цена ошибки в клиническом тексте несопоставима.
//
// НАЗВАНИЯ ЭКЗАМЕНОВ И ОРГАНОВ НЕ ПЕРЕВОДЯТСЯ: «USMLE», «TUS», «НМО» — имена
// собственные, врач ищет их именно так. Переведённый «USMLE» перестанет
// находиться поиском и узнаваться глазом.

import {
  getClient,
  isConfigured,
  describeApiError,
} from "../../education-ingest/extractors/claude.extractor.js";
import { EXAM_LANGUAGES } from "../../constants.js";
import {
  ValidationError,
  ServiceUnavailableError,
} from "../../../../common/utils/errors.js";
import { prepareSchema } from "../../../../common/utils/structuredOutputSchema.js";
import logger from "../../../../common/logger.js";

export const MODEL =
  process.env.EDUCATION_TRANSLATION_MODEL || "claude-opus-5";

// Название короткое, описание — до пары абзацев, и всё это в четырёх копиях.
const MAX_TOKENS = 8000;

const LANGUAGE_NAMES = {
  ru: "Russian",
  en: "English",
  az: "Azerbaijani",
  tr: "Turkish",
  ar: "Arabic",
};

const SYSTEM_PROMPT = `You translate the title and description of a medical exam-prep test.

Rules:
- The title is a catalogue heading, not a sentence: keep it as short as the original.
- Keep proper names of exams, boards and organisations EXACTLY as written: USMLE, PLAB, TUS, ECFMG, SCFHS, НМО and the like. Doctors search for them by name; a translated exam name stops being recognised.
- Keep medical terminology standard for the target language.
- Keep the description's meaning and length; do not summarise and do not expand.
- If the description is empty, return an empty string for it.
- Never add commentary, never expand an abbreviation.`;

function schemaFor(langs) {
  const properties = {};
  for (const lang of langs) {
    properties[lang] = {
      type: "object",
      additionalProperties: false,
      required: ["title", "description"],
      properties: {
        title: {
          type: "string",
          description: `Test title in ${LANGUAGE_NAMES[lang]}.`,
        },
        description: {
          type: "string",
          description: `Test description in ${LANGUAGE_NAMES[lang]}, empty string if the source is empty.`,
        },
      },
    };
  }
  return {
    type: "object",
    additionalProperties: false,
    required: langs,
    properties,
  };
}

/**
 * Перевести название и описание теста на указанные языки ОДНИМ вызовом.
 *
 * @param {object} p
 * @param {string} p.title
 * @param {string} [p.description]
 * @param {string} p.sourceLang
 * @param {string[]} p.targetLangs
 * @returns {Promise<Array<{lang: string, title: string, description: string}>>}
 */
export async function translateProgramContent({
  title,
  description = "",
  sourceLang,
  targetLangs,
}) {
  const langs = (targetLangs ?? []).filter(
    (l) => EXAM_LANGUAGES.includes(l) && l !== sourceLang,
  );
  if (!langs.length) return [];
  if (!String(title ?? "").trim()) {
    throw new ValidationError("Нечего переводить: название теста пустое");
  }
  if (!isConfigured()) {
    throw new ServiceUnavailableError("Translation model is not configured");
  }

  const fromName = LANGUAGE_NAMES[sourceLang] ?? LANGUAGE_NAMES.ru;
  const instruction = `Source test (${fromName}):

${JSON.stringify({ title, description }, null, 2)}

Translate it into: ${langs.map((l) => LANGUAGE_NAMES[l]).join(", ")}.
Return one object per language, keyed by its code: ${langs.join(", ")}.`;

  const client = getClient();

  let message;
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      output_config: {
        // Схема ЗНАЧЕНИЕМ ключа schema, не спредом: спред подмешивает type
        // самой схемы поверх "json_schema", и API отвечает 400. Тот же дефект
        // ловили в переводе вопросов и рубрик.
        format: {
          type: "json_schema",
          schema: prepareSchema(schemaFor(langs), logger, "тест"),
        },
      },
      messages: [{ role: "user", content: instruction }],
    });
    message = await stream.finalMessage();
  } catch (err) {
    const described = describeApiError(err);
    throw described.retryable
      ? new ServiceUnavailableError(described.message)
      : new ValidationError(described.message);
  }

  if (message.stop_reason === "refusal") {
    throw new ValidationError("Модель отказалась переводить название теста");
  }
  if (message.stop_reason === "max_tokens") {
    throw new ServiceUnavailableError("Ответ модели оборвался на пределе длины");
  }

  const block = message.content.find((b) => b.type === "text");
  if (!block) throw new ServiceUnavailableError("Модель вернула пустой ответ");

  let parsed;
  try {
    parsed = JSON.parse(block.text);
  } catch {
    throw new ServiceUnavailableError("Модель вернула некорректный JSON");
  }

  // Перевод с пустым названием отбрасываем: тест без заголовка хуже, чем тест
  // с заголовком на языке оригинала — во втором случае его хотя бы прочитают.
  return langs
    .map((lang) => ({
      lang,
      title: String(parsed?.[lang]?.title ?? "").trim().slice(0, 300),
      description: String(parsed?.[lang]?.description ?? "")
        .trim()
        .slice(0, 2000),
    }))
    .filter((t) => t.title);
}

export default translateProgramContent;
