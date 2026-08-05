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
  withApiRetry,
} from "../../education/education-ingest/extractors/claude.extractor.js";
import {
  ValidationError,
  ServiceUnavailableError,
} from "../../../common/utils/errors.js";
import logger from "../../../common/logger.js";
import { prepareSchema } from "../../../common/utils/structuredOutputSchema.js";

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

// Запасная модель при ПЕРЕГРУЗКЕ — не путать с подменой при отказе выше.
// Отказ и очередь лечатся по-разному: серверный fallback срабатывает, когда
// модель ответила отказом, а перегруженная модель не отвечает вовсе.
//
// Кейс сочиняется целиком, поэтому модель здесь влияет на качество сильнее,
// чем в разборе готового текста. Но выбор стоит не между Opus и Sonnet, а
// между кейсом от Sonnet и пропущенной ночью: черновик всё равно проходит
// проверку вторым проходом и правится человеком до публикации.
const OVERLOAD_FALLBACK_MODEL =
  process.env.RADIOLOGY_AI_FALLBACK_MODEL === "off"
    ? null
    : process.env.RADIOLOGY_AI_FALLBACK_MODEL || "claude-sonnet-5";

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
  effort = null,
}) {
  if (!isConfigured()) {
    throw new ServiceUnavailableError(
      "ИИ не настроен: задайте ANTHROPIC_API_KEY в .env сервера",
    );
  }

  const client = getClient();
  let message;
  try {
    // Повтор при перегрузке здесь важнее, чем где-либо: ночной генератор
    // работает без свидетелей, и необработанный сбой означает пропущенную
    // ночь — кейса за день просто не появится, и заметит это уже врач.
    message = await withApiRetry(
      async (attemptModel) => {
        // Бета-путь нужен ради fallbacks: на обычный вызов их не передать.
        const stream = client.beta.messages.stream({
          model: attemptModel,
          max_tokens: maxTokens,
          thinking: { type: "adaptive" },
          system,
          // См. common/utils/structuredOutputSchema.js: неподдерживаемый ключ
          // в схеме — это 400 на каждый вызов, а не изредка.
          output_config: {
            format: {
              type: "json_schema",
              schema: prepareSchema(schema, logger, what),
            },
            // Уровень усилий передаём, только если вызывающий код его выбрал:
            // отсутствие поля и явное "high" — не одно и то же по смыслу,
            // хотя сегодня совпадают по значению. Пусть в запросе будет
            // видно решение.
            ...(effort ? { effort } : {}),
          },
          messages: [{ role: "user", content: instruction }],
          ...(FALLBACKS_ENABLED
            ? { betas: [FALLBACK_BETA], fallbacks: "default" }
            : {}),
        });
        return await stream.finalMessage();
      },
      {
        logger,
        what,
        model: MODEL,
        fallbackModel: OVERLOAD_FALLBACK_MODEL,
        // Ночью спешить некуда, а перегрузка в часы пик держится дольше
        // секунд: три попытки с паузами до 8 с дешевле пропущенной ночи.
        retries: 3,
      },
    );
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
    // Категорию пишем в лог: она отличает ложное срабатывание фильтра на
    // медицинской теме от осмысленного отказа, а без неё все отказы выглядят
    // одинаково и непонятно, поможет ли переформулировка.
    logger?.warn?.(
      { what, category: message.stop_details?.category ?? null, model: message.model },
      "radiology: модель отклонила запрос",
    );
    throw new ValidationError(
      `ИИ отказался обрабатывать этот ${what} — переформулируйте тему нейтральнее`,
    );
  }
  if (message.stop_reason === "model_context_window_exceeded") {
    // Кончилось место под ВХОД, а не под ответ — совет «упростите ответ» тут
    // бесполезен.
    throw new ValidationError(
      `Материал не помещается в окно модели (${what}) — сократите исходный текст`,
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
