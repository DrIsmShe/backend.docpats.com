// server/modules/education/education-translation/translator.js
//
// Перевод ОДНОГО экзаменационного вопроса на один язык.
//
// Здесь только вызов модели и проверка формы ответа. Что делать с результатом
// (создать вопрос-перевод, обновить существующий, пометить устаревшим) — в
// translateItem.service.js.
//
// ЧТО ПЕРЕВОДИТСЯ И ЧТО НЕТ. Переводится только то, что врач читает: условие,
// тексты вариантов, объяснение. НЕ переводятся ключи вариантов ("A", "B") и
// correctKeys — ими проверяется ответ:
//
//     export function isAnswerCorrect(selectedKeys, correctKeys)
//
// Ключ — это идентификатор, а не текст. Переведи его — и правильный ответ
// перестанет находиться, причём молча: вопрос выглядит нормально, просто
// все отвечают неверно. Поэтому модель обязана вернуть ТОТ ЖЕ набор ключей,
// и это проверяется ниже жёстко, с отказом вместо догадки.
//
// Почему модель, а не словарь: вопрос — это связный клинический текст с
// терминологией, дозировками и единицами. Пословный перевод здесь даёт
// текст, по которому нельзя сдавать экзамен.

import {
  getClient,
  isConfigured,
  describeApiError,
} from "../education-ingest/extractors/claude.extractor.js";
import {
  ValidationError,
  ServiceUnavailableError,
} from "../../../common/utils/errors.js";
import { prepareSchema } from "../../../common/utils/structuredOutputSchema.js";
import logger from "../../../common/logger.js";

// Поднимать при КАЖДОЙ правке промпта: версия пишется в вопрос-перевод, и по
// ней потом видно, каким текстом получен перевод полугодовой давности.
export const PROMPT_VERSION = "edu-tr-2026-07-28";

export const MODEL =
  process.env.EDUCATION_TRANSLATION_MODEL || "claude-opus-5";

const MAX_TOKENS = 16000;

// Названия языков для промпта. Коды («az») модель понимает хуже, чем имена:
// «az» она иногда принимает за сокращение, а не за азербайджанский.
const LANGUAGE_NAMES = {
  ru: "Russian",
  en: "English",
  az: "Azerbaijani",
  tr: "Turkish",
  ar: "Arabic",
};

const SYSTEM_PROMPT = `You translate medical exam questions for practising physicians.

The output is used in a real examination bank. A mistranslated dose, unit,
laterality or negation changes which answer is correct, so accuracy outranks
fluency everywhere.

Rules:
- Translate the meaning, not word by word. The result must read as if it were
  written by a physician in the target language.
- Keep medical terminology precise. Where the target language commonly uses the
  Latin or English term, use it rather than inventing a calque.
- NEVER change numbers, units, doses, lab values, ages, or laterality
  (left/right). Copy them exactly.
- NEVER drop or add a negation. "no fever" must not become "fever".
- Preserve the option keys exactly as given. Return every option, in the same
  order, with the same key.
- Do not reveal, hint at, or reorder the correct answer. You are not told which
  option is correct, and you must not guess.
- Do not add commentary, disclaimers, or extra fields.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["stem", "options", "explanation"],
  properties: {
    stem: { type: "string" },
    options: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "text"],
        properties: {
          key: { type: "string" },
          text: { type: "string" },
        },
      },
    },
    explanation: { type: "string" },
  },
};

/**
 * Переводит содержание вопроса на один язык.
 *
 * @param {object}   p
 * @param {object}   p.item        исходный вопрос (lean или документ)
 * @param {string}   p.targetLang  код языка из EXAM_LANGUAGES
 * @returns {Promise<{stem, options: Array<{key,text}>, explanation, model, promptVersion}>}
 */
export async function translateItemContent({ item, targetLang }) {
  const fromName = LANGUAGE_NAMES[item.lang] ?? LANGUAGE_NAMES.ru;
  const toName = LANGUAGE_NAMES[targetLang];
  if (!toName) throw new ValidationError(`Unsupported language "${targetLang}"`);
  if (targetLang === item.lang) {
    throw new ValidationError("Source and target languages are the same");
  }
  if (!isConfigured()) {
    throw new ServiceUnavailableError("Translation model is not configured");
  }

  const sourceOptions = (item.options ?? []).map((o) => ({
    key: o.key,
    text: o.text,
  }));

  const payload = {
    stem: item.stem,
    options: sourceOptions,
    explanation: item.explanation ?? "",
  };

  const instruction = `Translate this exam question from ${fromName} to ${toName}.

Return the same structure: the stem, every option with its key unchanged, and
the explanation. If the explanation is empty, return an empty string.

${JSON.stringify(payload, null, 2)}`;

  const client = getClient();

  let message;
  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Адаптивное мышление: клинический текст с дозировками и отрицаниями —
      // ровно тот случай, где модель должна подумать, а не переводить с ходу.
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      output_config: {
        format: { type: "json_schema", ...prepareSchema(SCHEMA, logger, "вопрос") },
      },
      messages: [{ role: "user", content: instruction }],
    });
    message = await stream.finalMessage();
  } catch (err) {
    const described = describeApiError(err);
    logger?.error?.(
      {
        err,
        model: MODEL,
        itemId: String(item._id ?? ""),
        targetLang,
        retryable: described.retryable,
      },
      "exam item translation request failed",
    );
    throw described.retryable
      ? new ServiceUnavailableError(described.message)
      : new ValidationError(described.message);
  }

  // Отказ модели — штатный ответ с HTTP 200, а не исключение. Проверяем до
  // чтения content.
  if (message.stop_reason === "refusal") {
    throw new ValidationError("Model declined to translate this question", {
      category: message.stop_details?.category ?? null,
    });
  }
  if (message.stop_reason === "max_tokens") {
    throw new ValidationError(
      "Перевод не поместился в лимит ответа за один проход.",
      { overflow: true },
    );
  }

  const raw = message.content?.find((b) => b.type === "text")?.text ?? "";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ValidationError("Model returned malformed JSON");
  }

  return {
    ...assertSameOptionKeys(parsed, sourceOptions, targetLang),
    model: MODEL,
    promptVersion: PROMPT_VERSION,
  };
}

/**
 * Проверяет, что модель вернула ТОТ ЖЕ набор ключей вариантов, и раскладывает
 * переводы по исходному порядку.
 *
 * Это не формальность. Ответ проверяется по ключу, поэтому потерянный,
 * лишний или переименованный ключ означает вопрос, в котором правильный ответ
 * указывает не туда. Такую поломку не видно ни в админке, ни на глаз — видно
 * только по тому, что вопрос вдруг заваливают все. Поэтому при расхождении
 * отказываемся, а не достраиваем недостающее по индексу: догадка здесь
 * означала бы тихо испорченный экзамен.
 */
function assertSameOptionKeys(parsed, sourceOptions, targetLang) {
  const got = new Map((parsed.options ?? []).map((o) => [o.key, o.text]));
  const missing = sourceOptions.filter((o) => !got.has(o.key)).map((o) => o.key);
  const extra = [...got.keys()].filter(
    (k) => !sourceOptions.some((o) => o.key === k),
  );

  if (missing.length || extra.length) {
    throw new ValidationError(
      `Перевод вернул другой набор вариантов (${targetLang})`,
      { missing, extra },
    );
  }

  const emptyKeys = sourceOptions
    .filter((o) => !String(got.get(o.key) ?? "").trim())
    .map((o) => o.key);
  if (emptyKeys.length) {
    throw new ValidationError(
      `Перевод вернул пустые варианты (${targetLang})`,
      { keys: emptyKeys },
    );
  }
  if (!String(parsed.stem ?? "").trim()) {
    throw new ValidationError(`Перевод вернул пустое условие (${targetLang})`);
  }

  return {
    stem: parsed.stem.trim(),
    // Порядок берём из исходника, а не из ответа: даже при полном совпадении
    // ключей модель может переставить варианты, а «первый вариант» иногда
    // значим (например, «Ничего из перечисленного» принято держать последним).
    options: sourceOptions.map((o) => ({
      key: o.key,
      text: String(got.get(o.key)).trim(),
    })),
    explanation: String(parsed.explanation ?? "").trim(),
  };
}
