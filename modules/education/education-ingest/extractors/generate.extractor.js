// server/modules/education/education-ingest/extractors/generate.extractor.js
//
// Генерация вопросов моделью по теме (в отличие от извлечения из файла).
// Возвращает тот же формат, что и claude.extractor — { items,
// suggestedProgram, usage }, — поэтому дальше по конвейеру (normalizeDrafts,
// blueprint, draftItems, ревью) генерация и импорт неотличимы.
//
// Происхождение результата — ai_generated: публикация только после ревью
// человеком (гейт в item.service). Здесь это критично: модель пишет
// медицинские вопросы, и непроверенный факт стоит дорого.

import {
  GENERATION_JSON_SCHEMA,
  GENERATION_SYSTEM_PROMPT,
} from "./generate.schema.js";
import { getClient, describeApiError, isConfigured } from "./claude.extractor.js";
import {
  ValidationError,
  ServiceUnavailableError,
} from "../../../../common/utils/errors.js";
import logger from "../../../../common/logger.js";

const MODEL = process.env.EDUCATION_EXTRACTOR_MODEL || "claude-opus-4-8";
const MAX_TOKENS = 32000;

// Сколько вопросов просим за один вызов. Держим небольшим намеренно: на
// коротком батче модель тщательнее, реже повторяется и почти не рискует
// упереться в лимит вывода. Крупный заказ набирается несколькими батчами.
export const GENERATION_BATCH_SIZE = 20;

const LANG_NAMES = {
  ru: "русском",
  en: "английском",
  az: "азербайджанском",
  tr: "турецком",
  ar: "арабском",
};

/**
 * Сгенерировать батч вопросов по теме.
 *
 * @param {object} args
 * @param {string} args.topic       тема, как её задал оператор
 * @param {number} args.count       сколько вопросов в этом батче
 * @param {string} args.lang        язык вопросов
 * @param {string} [args.difficulty] easy | medium | hard | mixed
 * @param {object} [args.program]   программа — нужен blueprint для topicCode
 * @param {string[]} [args.avoidStems] тексты уже созданных вопросов (не повторять)
 * @returns {Promise<{items: object[], suggestedProgram: object|null, usage: object}>}
 */
export async function generate({
  topic,
  count,
  lang = "ru",
  difficulty = "mixed",
  program,
  avoidStems = [],
}) {
  if (!isConfigured()) {
    throw new ServiceUnavailableError(
      "AI generator is not configured: set ANTHROPIC_API_KEY",
    );
  }
  const cleanTopic = String(topic ?? "").trim();
  if (!cleanTopic) throw new ValidationError("Тема генерации не указана");

  const topicHint = (program?.blueprint ?? [])
    .map((s) => `- ${s.code}: ${s.title}`)
    .join("\n");

  // Список «не повторять» держим коротким: весь банк в промпт не влезет, а
  // последние вопросы отсекают самые очевидные дубли соседних батчей.
  const avoid = avoidStems
    .slice(-40)
    .map((s) => `- ${String(s).slice(0, 160)}`)
    .join("\n");

  const difficultyLine =
    difficulty && difficulty !== "mixed"
      ? `Сложность всех вопросов: ${difficulty}.`
      : "Смешай вопросы разной сложности: часть простых, часть средних, часть трудных.";

  const instruction = [
    `Тема: «${cleanTopic}».`,
    `Сделай ${count} вопросов на ${LANG_NAMES[lang] ?? "русском"} языке.`,
    difficultyLine,
    topicHint
      ? `Разделы теста (проставь topicCode из них):\n${topicHint}`
      : "Раздели тему на логичные подтемы сам и заполни suggestedProgram.",
    avoid ? `Уже созданы такие вопросы — НЕ повторяй их:\n${avoid}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const client = getClient();

  let message;
  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" },
      system: GENERATION_SYSTEM_PROMPT,
      output_config: {
        format: { type: "json_schema", schema: GENERATION_JSON_SCHEMA },
      },
      messages: [{ role: "user", content: [{ type: "text", text: instruction }] }],
    });
    message = await stream.finalMessage();
  } catch (err) {
    const described = describeApiError(err);
    logger?.error?.(
      { err, model: MODEL, status: err?.status ?? null },
      "AI generation request failed",
    );
    throw described.retryable
      ? new ServiceUnavailableError(described.message)
      : new ValidationError(described.message);
  }

  if (message.stop_reason === "refusal") {
    throw new ValidationError(
      "Модель отказалась генерировать вопросы по этой теме. Уточните формулировку темы.",
    );
  }
  if (message.stop_reason === "max_tokens") {
    // Просили за батч слишком много — вернём флаг, чтобы сервис уменьшил
    // размер батча и повторил. Оператору вмешиваться не нужно.
    throw new ValidationError(
      "Батч генерации не поместился в лимит ответа.",
      { overflow: true },
    );
  }

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock) {
    throw new ServiceUnavailableError("AI generator returned no content");
  }

  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    throw new ServiceUnavailableError(
      "AI generator returned malformed JSON despite the schema constraint",
    );
  }

  return {
    items: Array.isArray(parsed.items)
      ? parsed.items.map((it) => ({
          ...it,
          // Модель — автор, ответ она знает; в разбор импорта такие вопросы
          // идут как уверенные, но всё равно через ревью.
          confidence: 1,
          sourcePage: null,
          notes: "",
        }))
      : [],
    suggestedProgram: parsed.suggestedProgram ?? null,
    usage: {
      inputTokens: message.usage?.input_tokens ?? 0,
      outputTokens: message.usage?.output_tokens ?? 0,
    },
  };
}

export default { name: "generate", isConfigured, generate };
