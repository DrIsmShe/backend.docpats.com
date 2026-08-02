// server/modules/dictation/providers/structure.provider.js
//
// Сборка черновика осмотра из расшифровки — вызов Claude со структурированным
// выводом. Провайдер сменный: движок знает только про интерфейс
// { isConfigured, structure }, а не про Anthropic.
//
// Устройство повторяет radiology/ai/aiRunner.js и diagnostics/ai/runner.js —
// намеренно: три точки вызова модели в проекте должны ломаться одинаково и
// чиниться одинаково. Отсюда же берётся клиент и разбор ошибок API.

import {
  getClient,
  describeApiError,
} from "../../education/education-ingest/extractors/claude.extractor.js";
import {
  ValidationError,
  ServiceUnavailableError,
} from "../../../common/utils/errors.js";
import logger from "../../../common/logger.js";
import { prepareSchema } from "../../../common/utils/structuredOutputSchema.js";
import { STRUCTURE_SCHEMA, STRUCTURE_SYSTEM } from "../prompts/structure.schema.js";

// Модель. Пин через DICTATION_MODEL в .env; по умолчанию — актуальная Opus.
// Здесь собирается медицинская запись, и цена ошибки выше экономии на модели.
export const MODEL = process.env.DICTATION_MODEL || "claude-opus-5";

// Глубина рассуждения. Задача преобразующая, а не исследовательская: разложить
// сказанное по полям. Высокий уровень усилий здесь не улучшает результат, а
// повышает риск, что модель начнёт «дополнять картину» — ровно то, что запрещено.
const EFFORT = process.env.DICTATION_EFFORT || "low";

// Запасная модель при отказе классификаторов. Медицинский текст — как раз та
// область, где ложное срабатывание вероятно: описание травмы, отравления или
// инфекции легко выглядит «опасной темой». Без запасного пути врач получал бы
// отказ на ровном месте.
//
// "default" — сервер сам подбирает замену по категории отказа; так не придётся
// мигрировать, когда конкретная запасная модель уйдёт из поддержки.
const FALLBACKS_ENABLED = process.env.ANTHROPIC_FALLBACKS !== "off";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

// Расшифровка полутора минут речи — это единицы килобайт, ответ ещё меньше.
// Запас нужен не под объём, а под то, чтобы ответ не оборвался: оборванный
// JSON — это мусор, а не «немного короче».
const MAX_TOKENS = 8000;

/** Настроен ли ИИ (тот же ключ, что у остальных ИИ-функций проекта). */
export function isConfigured() {
  return Boolean(
    (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "").trim(),
  );
}

const str = (v, max = 8000) => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

/**
 * Расшифровка → черновик осмотра.
 *
 * @param {object} args
 * @param {string} args.transcript текст надиктовки
 * @param {string} [args.hint]     подсказка врача (специальность, шаблон)
 * @returns {Promise<{draft: object, model: string, usage: object}>}
 */
export async function structure({ transcript, hint } = {}) {
  const text = String(transcript ?? "").trim();
  if (!text) throw new ValidationError("Пустая расшифровка — нечего разбирать");

  if (!isConfigured()) {
    throw new ServiceUnavailableError(
      "ИИ не настроен: задайте ANTHROPIC_API_KEY в .env сервера",
    );
  }

  const instruction = [
    hint ? `Контекст от врача: ${str(hint, 500)}` : null,
    "Надиктовка врача:",
    text,
  ]
    .filter(Boolean)
    .join("\n\n");

  const client = getClient();
  let message;
  try {
    // Стрим — чтобы длинная надиктовка не упёрлась в HTTP-таймаут SDK.
    // Бета-путь нужен ради fallbacks: на обычный вызов их не передать.
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" },
      system: STRUCTURE_SYSTEM,
      output_config: {
        format: {
          type: "json_schema",
          schema: prepareSchema(STRUCTURE_SCHEMA, logger, "черновик осмотра"),
        },
        effort: EFFORT,
      },
      messages: [{ role: "user", content: instruction }],
      ...(FALLBACKS_ENABLED
        ? { betas: [FALLBACK_BETA], fallbacks: "default" }
        : {}),
    });
    message = await stream.finalMessage();
  } catch (err) {
    const described = describeApiError(err);
    logger?.error?.(
      { err, model: MODEL, status: err?.status ?? null },
      "dictation: запрос к модели не прошёл",
    );
    throw described.retryable
      ? new ServiceUnavailableError(described.message)
      : new ValidationError(described.message);
  }

  // С включёнными fallbacks отказ означает, что отклонила вся цепочка моделей.
  if (message.stop_reason === "refusal") {
    logger?.warn?.(
      { category: message.stop_details?.category ?? null, model: message.model },
      "dictation: модель отклонила надиктовку",
    );
    throw new ValidationError(
      "ИИ отказался обрабатывать эту надиктовку. Черновик придётся заполнить вручную.",
    );
  }
  if (message.stop_reason === "model_context_window_exceeded") {
    throw new ValidationError(
      "Надиктовка слишком длинная для одной обработки — разбейте её на части",
    );
  }
  if (message.stop_reason === "max_tokens") {
    throw new ServiceUnavailableError(
      "Ответ ИИ оборвался на пределе длины — попробуйте надиктовать короче",
    );
  }

  const block = message.content.find((b) => b.type === "text");
  if (!block) throw new ServiceUnavailableError("ИИ вернул пустой ответ");

  let parsed;
  try {
    parsed = JSON.parse(block.text);
  } catch {
    throw new ServiceUnavailableError("ИИ вернул некорректный JSON");
  }

  // Нормализация. Пустые строки приводим к null: для карты «поле не заполнено»
  // и «поле заполнено пустотой» — одно и то же, и хранить надо одно значение.
  const draft = {
    complaints: str(parsed.complaints),
    anamnesisMorbi: str(parsed.anamnesisMorbi),
    anamnesisVitae: str(parsed.anamnesisVitae),
    statusPreasens: str(parsed.statusPreasens),
    statusLocalis: str(parsed.statusLocalis),
    mainDiagnosisText: str(parsed.mainDiagnosisText, 2000),
    mainDiagnosisCode: str(parsed.mainDiagnosisCode, 20),
    recommendations: str(parsed.recommendations),
    ctScanResults: str(parsed.ctScanResults),
    mriResults: str(parsed.mriResults),
    ultrasoundResults: str(parsed.ultrasoundResults),
    laboratoryTestResults: str(parsed.laboratoryTestResults),
  };

  return {
    draft,
    // Модель, которая реально ответила: при срабатывании fallbacks это не та,
    // которую просили, и записывать надо её.
    model: message.model ?? MODEL,
    usage: {
      inputTokens: message.usage?.input_tokens ?? 0,
      outputTokens: message.usage?.output_tokens ?? 0,
    },
  };
}
