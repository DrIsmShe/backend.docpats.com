// server/modules/radiology/ai/aiRunner.js
//
// Один вызов модели со structured outputs — общий для генератора кейсов
// (caseGenerator.js) и верификатора (caseVerifier.js). Вынесено сюда, чтобы
// обработка ошибок API, обрыва по max_tokens и битого JSON жила в одном
// месте: это ровно те три случая, где «почти работает» означает мусор в
// учебном кейсе.
//
// Клиент Anthropic и разбор ошибок берём из education-экстрактора — там же
// живёт очистка ключа от кавычек и понятные сообщения про 401/403/429.

import {
  getClient,
  describeApiError,
} from "../../education/education-ingest/extractors/claude.extractor.js";
import {
  ValidationError,
  ServiceUnavailableError,
} from "../../../common/utils/errors.js";
import logger from "../../../common/logger.js";

// Модель. Пин через RADIOLOGY_AI_MODEL в .env; по умолчанию — актуальная
// Opus: кейс придумывает медицинские данные (референсы, значимость находок),
// и цена ошибки здесь выше экономии на модели.
export const MODEL =
  process.env.RADIOLOGY_AI_MODEL ||
  process.env.EDUCATION_EXTRACTOR_MODEL ||
  "claude-opus-5";

// Запасная модель при отказе классификаторов безопасности. Медицинский
// материал — как раз та область, где ложное срабатывание вероятно: описание
// травмы, отравления или инфекции легко выглядит «опасной темой», и без
// запасного пути автор получал бы отказ на ровном месте.
//
// "default" — сервер сам подбирает замену по категории отказа; так не придётся
// мигрировать, когда конкретная запасная модель уйдёт из поддержки.
// Выключатель — на случай, если бета станет недоступна: иначе это 400 на
// каждый вызов модели в проде.
const FALLBACKS_ENABLED = process.env.ANTHROPIC_FALLBACKS !== "off";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Настроен ли ИИ (тот же ключ, что у остальных ИИ-функций модуля). */
export function isConfigured() {
  return Boolean(
    (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "").trim(),
  );
}

/**
 * Запрос к модели с гарантированной формой ответа.
 *
 * Стрим — потому что кейс с рассуждением генерируется дольше HTTP-таймаута
 * SDK. max_tokens ограничивает мышление И текст вместе, поэтому по умолчанию
 * берём запас: оборванный ответ — это невалидный JSON, а не «немного короче».
 *
 * @param {object} args
 * @param {string} args.system       системный промпт
 * @param {string} args.instruction  пользовательская инструкция
 * @param {object} args.schema       JSON-схема ответа (structured outputs)
 * @param {number} [args.maxTokens]
 * @param {string} [args.what]       что генерируем — для текста ошибок
 * @returns {Promise<{parsed: object, usage: {inputTokens: number, outputTokens: number}}>}
 */
export async function runJson({
  system,
  instruction,
  schema,
  maxTokens = 16000,
  what = "кейс",
}) {
  if (!isConfigured()) {
    throw new ServiceUnavailableError(
      "ИИ не настроен: задайте ANTHROPIC_API_KEY в .env сервера",
    );
  }

  const client = getClient();
  let message;
  try {
    // Бета-путь нужен ради fallbacks: на обычный вызов их не передать.
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      system,
      output_config: { format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: instruction }],
      ...(FALLBACKS_ENABLED
        ? { betas: [FALLBACK_BETA], fallbacks: "default" }
        : {}),
    });
    message = await stream.finalMessage();
  } catch (err) {
    const described = describeApiError(err);
    logger?.error?.(
      { err, model: MODEL, status: err?.status ?? null, what },
      "radiology AI request failed",
    );
    throw described.retryable
      ? new ServiceUnavailableError(described.message)
      : new ValidationError(described.message);
  }

  if (message.stop_reason === "refusal") {
    // С включёнными fallbacks это значит, что отказалась вся цепочка моделей.
    throw new ValidationError(
      `ИИ отказался обрабатывать этот ${what} — переформулируйте тему нейтральнее`,
    );
  }
  if (message.stop_reason === "max_tokens") {
    throw new ServiceUnavailableError(
      `Ответ ИИ оборвался на пределе длины — упростите ${what} и попробуйте снова`,
    );
  }

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock) throw new ServiceUnavailableError("ИИ вернул пустой ответ");
  try {
    return {
      parsed: JSON.parse(textBlock.text),
      // Модель, которая реально ответила: при срабатывании fallbacks это не та,
      // которую просили, и записывать надо её.
      model: message.model ?? MODEL,
      usage: {
        inputTokens: message.usage?.input_tokens ?? 0,
        outputTokens: message.usage?.output_tokens ?? 0,
      },
    };
  } catch {
    throw new ServiceUnavailableError("ИИ вернул некорректный JSON");
  }
}

// ─── Мелкие нормализаторы, общие для генератора и верификатора ─────────

export const str = (v, max) => String(v ?? "").trim().slice(0, max);

export const list = (arr, max, itemMax) =>
  (Array.isArray(arr) ? arr : [])
    .map((s) => String(s ?? "").trim().slice(0, itemMax))
    .filter(Boolean)
    .slice(0, max);
