// server/modules/radiology/translation/caseTranslator.js
//
// Вызов модели для перевода одного кейса на один язык.
//
// ЗДЕСЬ ДВА РАЗНЫХ ПЕРЕВОДА В ОДНОМ ЗАПРОСЕ, и путать их нельзя:
//
//   fields — проза, которую врач читает: условие, клинический контекст,
//     разбор находок, эталонное заключение. Ошибка здесь заметна и
//     некрасива;
//
//   diagnosisKeys / diagnosisSynonyms — список формулировок, С КОТОРЫМИ
//     СВЕРЯЕТСЯ ответ врача (diagnosisMatcher.js). Это не проза: нужны те
//     слова, которыми врач на этом языке НАПИШЕТ диагноз, включая привычные
//     сокращения и латиницу. Ошибка здесь не видна вообще — просто все,
//     кто ответил верно, получают ноль.
//
// Поэтому в промпте они описаны раздельно и с разными требованиями: проза
// переводится, список — воспроизводится так, как его напишет практикующий
// врач.

import {
  getClient,
  isConfigured,
  describeApiError,
} from "../../education/education-ingest/extractors/claude.extractor.js";
import {
  ValidationError,
  ServiceUnavailableError,
} from "../../../common/utils/errors.js";
import { prepareSchema } from "../../../common/utils/structuredOutputSchema.js";
import logger from "../../../common/logger.js";

export const PROMPT_VERSION = "arena-tr-2026-07-28";

export const MODEL =
  process.env.ARENA_TRANSLATION_MODEL ||
  process.env.EDUCATION_TRANSLATION_MODEL ||
  "claude-opus-5";

const MAX_TOKENS = 24000;

const LANGUAGE_NAMES = {
  ru: "Russian",
  en: "English",
  az: "Azerbaijani",
  tr: "Turkish",
  ar: "Arabic",
};

const SYSTEM_PROMPT = `You translate clinical teaching cases for practising physicians.

The output is used both to display the case and to MARK the physician's answer,
so two different jobs are involved and they have different rules.

1. "fields" — prose the physician reads (case title, clinical context,
   explanations of findings, the reference report). Translate the meaning so it
   reads as a physician would write it in the target language.

2. "diagnosisKeys" and "diagnosisSynonyms" — the list of accepted wordings the
   physician's typed diagnosis is matched against, literally, by string
   comparison. These are NOT prose. Give the words a physician writing in the
   target language would actually type for this diagnosis: the standard term,
   the common short form, and the Latin/English term if it is in everyday use
   in that language. Prefer several short forms over one long formal phrase —
   a wording that is missing from this list scores zero even though the
   physician was right.

Rules for everything:
- NEVER change numbers, units, doses, lab values, ages, or laterality
  (left/right). Copy them exactly.
- NEVER drop or add a negation.
- Keep medical terminology precise; use the established term in the target
  language rather than inventing a calque.
- Return every requested path, with the path string copied exactly.
- Do not add commentary or extra fields.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fields", "diagnosisKeys", "diagnosisSynonyms"],
  properties: {
    fields: {
      type: "array",
      minItems: 0,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "text"],
        properties: {
          path: { type: "string" },
          text: { type: "string" },
        },
      },
    },
    diagnosisKeys: { type: "array", minItems: 0, items: { type: "string" } },
    diagnosisSynonyms: { type: "array", minItems: 0, items: { type: "string" } },
  },
};

/**
 * @param {object} p
 * @param {string} p.targetLang
 * @param {string} [p.sourceLang]
 * @param {Record<string,string>} p.fields         путь → исходный текст
 * @param {string[]} p.diagnosisKeys
 * @param {string[]} p.diagnosisSynonyms
 */
export async function translateCaseContent({
  targetLang,
  sourceLang = "ru",
  fields,
  diagnosisKeys = [],
  diagnosisSynonyms = [],
}) {
  const toName = LANGUAGE_NAMES[targetLang];
  if (!toName) throw new ValidationError(`Unsupported language "${targetLang}"`);
  if (targetLang === sourceLang) {
    throw new ValidationError("Source and target languages are the same");
  }
  if (!isConfigured()) {
    throw new ServiceUnavailableError("Translation model is not configured");
  }

  const paths = Object.keys(fields ?? {});
  if (!paths.length && !diagnosisKeys.length) {
    throw new ValidationError("Nothing to translate");
  }

  const instruction = `Translate this clinical case from ${
    LANGUAGE_NAMES[sourceLang] ?? "Russian"
  } to ${toName}.

Return one entry in "fields" for every path below, with the path copied exactly.

${JSON.stringify(
  {
    fields: paths.map((path) => ({ path, text: fields[path] })),
    diagnosisKeys,
    diagnosisSynonyms,
  },
  null,
  2,
)}`;

  let message;
  try {
    const stream = getClient().messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      output_config: {
        format: { type: "json_schema", ...prepareSchema(SCHEMA, logger, "кейс") },
      },
      messages: [{ role: "user", content: instruction }],
    });
    message = await stream.finalMessage();
  } catch (err) {
    const described = describeApiError(err);
    logger?.error?.(
      { err, model: MODEL, targetLang, retryable: described.retryable },
      "arena case translation request failed",
    );
    throw described.retryable
      ? new ServiceUnavailableError(described.message)
      : new ValidationError(described.message);
  }

  if (message.stop_reason === "refusal") {
    throw new ValidationError("Model declined to translate this case", {
      category: message.stop_details?.category ?? null,
    });
  }
  if (message.stop_reason === "max_tokens") {
    throw new ValidationError("Перевод кейса не поместился в лимит ответа.", {
      overflow: true,
    });
  }

  const raw = message.content?.find((b) => b.type === "text")?.text ?? "";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ValidationError("Model returned malformed JSON");
  }

  return {
    fields: pickRequestedPaths(parsed.fields, paths, targetLang),
    // Пустой список принятых формулировок означал бы, что на этом языке
    // диагноз не засчитывается никому. Лучше отказаться и оставить кейс без
    // перевода: тогда врач хотя бы читает оригинал и отвечает по нему.
    diagnosisKeys: requireTerms(parsed.diagnosisKeys, diagnosisKeys, targetLang),
    diagnosisSynonyms: cleanTerms(parsed.diagnosisSynonyms),
    model: MODEL,
    promptVersion: PROMPT_VERSION,
  };
}

/**
 * Оставляет только запрошенные пути и требует, чтобы вернулись все.
 *
 * Лишний путь — признак того, что модель придумала поле; недостающий означал
 * бы кусок кейса, молча оставшийся на языке оригинала посреди переведённого
 * текста. И то и другое лучше отклонить: перевода не будет, но и подмены
 * содержания тоже.
 */
function pickRequestedPaths(rows, requested, lang) {
  const got = new Map(
    (Array.isArray(rows) ? rows : [])
      .filter((r) => typeof r?.path === "string")
      .map((r) => [r.path, String(r.text ?? "").trim()]),
  );
  const missing = requested.filter((p) => !got.get(p));
  if (missing.length) {
    throw new ValidationError(
      `Перевод не вернул поля (${lang}): ${missing.slice(0, 5).join(", ")}`,
      { missing },
    );
  }
  return Object.fromEntries(requested.map((p) => [p, got.get(p)]));
}

function cleanTerms(list) {
  return [
    ...new Set(
      (Array.isArray(list) ? list : [])
        .map((t) => String(t ?? "").trim())
        .filter(Boolean),
    ),
  ];
}

function requireTerms(list, source, lang) {
  const terms = cleanTerms(list);
  if (source.length && !terms.length) {
    throw new ValidationError(
      `Перевод не вернул принятые формулировки диагноза (${lang})`,
    );
  }
  return terms;
}
