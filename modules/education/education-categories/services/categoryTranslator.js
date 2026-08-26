// server/modules/education/education-categories/services/categoryTranslator.js
//
// Перевод названия рубрики каталога на остальные языки.
//
// ОТДЕЛЬНО ОТ ПЕРЕВОДА ВОПРОСОВ, и намеренно устроен иначе. Вопрос — связный
// клинический текст с дозировками и отрицаниями, поэтому education-translation
// переводит его по одному языку за вызов, с адаптивным мышлением и точкой
// кэширования на исходнике. Рубрика — это два коротких поля («Психология»,
// «Международные экзамены»), и делить их на четыре вызова с рассуждением
// значит платить четыре раза за работу, которая укладывается в один заход без
// раздумий вовсе.
//
// ЧТО ПЕРЕВОДИТСЯ. name и description. Ни slug, ни icon, ни порядок:
// slug — идентификатор в ссылках, и его перевод сломал бы адреса.
//
// НАЗВАНИЯ ОРГАНИЗАЦИЙ И ЭКЗАМЕНОВ НЕ ПЕРЕВОДЯТСЯ. «USMLE», «TUS», «НМО» —
// это имена собственные, и врач ищет их именно так, как они называются.
// Переведённый «USMLE» перестанет находиться поиском и перестанет узнаваться
// глазом; для рубрики каталога это цена выше любой пользы от перевода.

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

// Названия рубрик короткие, но их до пяти штук в ответе — с запасом.
const MAX_TOKENS = 4000;

const LANGUAGE_NAMES = {
  ru: "Russian",
  en: "English",
  az: "Azerbaijani",
  tr: "Turkish",
  ar: "Arabic",
};

const SYSTEM_PROMPT = `You translate short catalogue rubric names for a medical exam-prep platform.

Rules:
- Translate only the meaning of the rubric, keep it as short as the original. These are navigation labels, not sentences.
- Keep proper names of exams, boards and organisations EXACTLY as written: USMLE, PLAB, TUS, ECFMG, НМО and the like. Doctors search for them by name; a translated exam name stops being recognised.
- Keep medical terminology standard for the target language.
- If the description is empty, return an empty string for it.
- Never add commentary, never expand an abbreviation.`;

function schemaFor(langs) {
  const properties = {};
  for (const lang of langs) {
    properties[lang] = {
      type: "object",
      additionalProperties: false,
      required: ["name", "description"],
      properties: {
        name: { type: "string", description: `Rubric name in ${LANGUAGE_NAMES[lang]}.` },
        description: {
          type: "string",
          description: `Rubric description in ${LANGUAGE_NAMES[lang]}, empty string if the source is empty.`,
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
 * Перевести рубрику на указанные языки ОДНИМ вызовом.
 *
 * @param {object} p
 * @param {string} p.name
 * @param {string} [p.description]
 * @param {string} p.sourceLang
 * @param {string[]} p.targetLangs
 * @returns {Promise<Array<{lang: string, name: string, description: string}>>}
 */
export async function translateCategoryContent({
  name,
  description = "",
  sourceLang,
  targetLangs,
}) {
  const langs = (targetLangs ?? []).filter(
    (l) => EXAM_LANGUAGES.includes(l) && l !== sourceLang,
  );
  if (!langs.length) return [];
  if (!String(name ?? "").trim()) {
    throw new ValidationError("Нечего переводить: имя рубрики пустое");
  }
  if (!isConfigured()) {
    throw new ServiceUnavailableError("Translation model is not configured");
  }

  const fromName = LANGUAGE_NAMES[sourceLang] ?? LANGUAGE_NAMES.ru;
  const instruction = `Source rubric (${fromName}):

${JSON.stringify({ name, description }, null, 2)}

Translate it into: ${langs.map((l) => LANGUAGE_NAMES[l]).join(", ")}.
Return one object per language, keyed by its code: ${langs.join(", ")}.`;

  const client = getClient();

  let message;
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Без адаптивного мышления намеренно: это перевод ярлыка в два слова, и
      // раздумья здесь только дороже. У вопросов банка ровно наоборот — там
      // мышление включено, потому что цена ошибки в дозировке несопоставима.
      system: SYSTEM_PROMPT,
      output_config: {
        // Схема ЗНАЧЕНИЕМ ключа schema, не спредом: спред подмешивает type
        // самой схемы поверх "json_schema", и API отвечает 400. Тот же дефект
        // ловили в переводе вопросов и кейсов арены.
        format: {
          type: "json_schema",
          schema: prepareSchema(schemaFor(langs), logger, "рубрика"),
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
    throw new ValidationError("Модель отказалась переводить название рубрики");
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

  // Пустое имя перевода отбрасываем: рубрика без названия хуже, чем рубрика
  // на языке оригинала — во втором случае врач хотя бы прочитает её.
  return langs
    .map((lang) => ({
      lang,
      name: String(parsed?.[lang]?.name ?? "").trim().slice(0, 200),
      description: String(parsed?.[lang]?.description ?? "").trim().slice(0, 2000),
    }))
    .filter((t) => t.name);
}

export default translateCategoryContent;
