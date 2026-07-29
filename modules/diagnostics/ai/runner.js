// server/modules/diagnostics/ai/runner.js
//
// Один вызов модели со structured outputs — общий для всех анализаторов
// модуля. Устроен как radiology/ai/aiRunner.js и по тем же причинам: обработка
// отказа модели, обрыва по max_tokens и битого JSON должна жить в одном месте.
//
// Своя копия, а не импорт из radiology, сознательно: у модулей разный
// юридический статус (учебный против клинического) и разная политика — здесь
// ниже температура ответственности, свой промпт-версионинг и свой ключ модели
// в .env. Связывать их одним файлом означало бы, что правка ради тренажёра
// меняет поведение в работе с живым пациентом.
//
// PROMPT_VERSION поднимать при КАЖДОМ изменении системного промпта: он
// записывается в provenance задания, и по нему потом видно, каким текстом был
// получен вывод полугодовой давности.

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

export const PROMPT_VERSION = "diag-2026-07-29";

export const MODEL =
  process.env.DIAGNOSTICS_AI_MODEL ||
  process.env.RADIOLOGY_AI_MODEL ||
  "claude-opus-5";

// Запасная модель на случай отказа классификаторов безопасности.
//
// Классификаторы Opus 5 иногда отклоняют запрос целиком (HTTP 200,
// stop_reason: "refusal"), и медицинский материал — как раз та область, где
// ложное срабатывание вероятно: описание травмы или отравления легко
// выглядит «опасной темой». Без запасного пути врач просто получал бы отказ.
//
// "default" — режим, в котором сервер сам выбирает замену по категории
// отказа. Это лучше жёстко вписанной модели: не придётся мигрировать, когда
// конкретная модель уйдёт из поддержки.
//
// Выключатель на случай, если бета перестанет быть доступной: без него
// недоступность параметра означала бы 400 на каждый вызов модели в проде.
const FALLBACKS_ENABLED = process.env.ANTHROPIC_FALLBACKS !== "off";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Уровни усилий по типам работы модуля.
 *
 * ЗАЧЕМ ЯВНО. Пока поле не задано, API работает на "high" — и для нас это
 * неверно в ОБЕ стороны. Распознавание бланка — это перенос напечатанного, а
 * не рассуждение: на "high" мы платим за размышления там, где нужна
 * аккуратность глаза. Разбор клинического случая — наоборот, ровно тот
 * случай, ради которого стоит брать верхний уровень.
 *
 * Разница не косметическая: уровень усилий управляет и глубиной мышления, и
 * общим расходом токенов, то есть напрямую ценой и задержкой.
 *
 * Настраивается через .env: подобрать уровни можно только на своих данных,
 * а не по общим рекомендациям.
 */
export const EFFORT = {
  // Разбор случая: цена ошибки высокая, объём текста небольшой.
  analysis: process.env.DIAGNOSTICS_EFFORT_ANALYSIS || "high",
  // Распознавание документа: механическая задача, много входных токенов.
  extraction: process.env.DIAGNOSTICS_EFFORT_EXTRACTION || "medium",
};

export function isConfigured() {
  return Boolean(
    (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "").trim(),
  );
}

/**
 * Запрос к модели с гарантированной формой ответа.
 *
 * @param {object} args
 * @param {string} args.system      системный промпт
 * @param {string} args.instruction данные и задание
 * @param {object} args.schema      JSON-схема ответа
 * @param {number} [args.maxTokens]
 * @param {string} [args.what]      что разбираем — для текста ошибки
 * @returns {Promise<{parsed: object, usage: {inputTokens: number, outputTokens: number}}>}
 */
export async function runJson({
  system,
  instruction,
  schema,
  // Потолок длины ответа. На Opus 5 мышление включено по умолчанию и делит
  // этот бюджет с текстом ответа — при тесном потолке разбор обрывается на
  // середине. Запрос идёт стримом, поэтому HTTP-таймаут здесь не ограничение
  // и скупиться незачем.
  maxTokens = 32000,
  what = "материал",
  // Уровень усилий модели. По умолчанию API работает на "high"; для разных
  // задач модуля это неверно в обе стороны — см. EFFORT ниже.
  effort = null,
  // Готовые блоки содержимого — для случаев, когда в запрос уходит не только
  // текст (изображение бланка, страница PDF). Если заданы, instruction
  // игнорируется: собрать блоки правильно может только вызывающий код.
  content = null,
}) {
  if (!isConfigured()) {
    throw new ServiceUnavailableError(
      "ИИ не настроен: задайте ANTHROPIC_API_KEY в .env сервера",
    );
  }

  const client = getClient();
  let message;
  try {
    // Стрим — потому что разбор с рассуждением дольше HTTP-таймаута SDK.
    // Бета-путь нужен ради fallbacks; на обычный вызов их не передать.
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      system,
      // Схема приводится к подмножеству, которое принимает API: лишний ключ
      // вроде maxItems даёт 400 на КАЖДЫЙ вызов, и узнаёт об этом врач.
      output_config: {
        format: { type: "json_schema", schema: prepareSchema(schema, logger, what) },
        // Уровень усилий передаём, только если вызывающий код его выбрал:
        // отсутствие поля и явное "high" — не одно и то же по смыслу, хотя
        // сегодня совпадают по значению. Пусть в запросе будет видно решение.
        ...(effort ? { effort } : {}),
      },
      messages: [{ role: "user", content: content ?? instruction }],
      ...(FALLBACKS_ENABLED
        ? { betas: [FALLBACK_BETA], fallbacks: "default" }
        : {}),
    });
    message = await stream.finalMessage();
  } catch (err) {
    const described = describeApiError(err);
    logger?.error?.(
      { err, model: MODEL, status: err?.status ?? null, what },
      "diagnostics AI request failed",
    );
    throw described.retryable
      ? new ServiceUnavailableError(described.message)
      : new ValidationError(described.message);
  }

  if (message.stop_reason === "refusal") {
    // Отказ — это результат, а не сбой: врачу так и пишем. С включёнными
    // fallbacks это означает, что отказалась ВСЯ цепочка моделей, а не одна.
    //
    // Категорию отказа логируем: она отличает ложное срабатывание фильтра на
    // клиническом материале (описание отравления, инфекции) от осмысленного
    // отказа. Без неё все отказы выглядят одинаково, и понять, помогает ли
    // переформулировка, невозможно. В текст врачу категорию не выносим —
    // это внутренняя классификация, и объяснять её врачу нечем.
    logger?.warn?.(
      { what, category: message.stop_details?.category ?? null, model: message.model },
      "diagnostics: модель отклонила запрос",
    );
    throw new ValidationError(
      `Модель отказалась разбирать ${what}. Если материал клинический, ` +
        `перескажите его нейтральнее и повторите — это ограничение фильтров, ` +
        `а не оценка вашего запроса.`,
    );
  }
  if (message.stop_reason === "model_context_window_exceeded") {
    // Не то же самое, что max_tokens: закончилось место под ВХОД, а не под
    // ответ. Совет «сократите ответ» здесь бесполезен и сбивает с толку —
    // сокращать надо материал.
    throw new ValidationError(
      `Материал не помещается в окно модели (${what}). Разберите его частями: ` +
        `оставьте в деле ключевые документы, а остальные добавьте отдельным разбором.`,
    );
  }
  if (message.stop_reason === "max_tokens") {
    throw new ServiceUnavailableError(
      `Ответ оборвался на пределе длины — сократите объём материала (${what})`,
    );
  }

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock) throw new ServiceUnavailableError("Модель вернула пустой ответ");

  try {
    return {
      parsed: JSON.parse(textBlock.text),
      // Модель, которая РЕАЛЬНО ответила. При срабатывании fallbacks это не
      // та, что мы просили, и в происхождении вывода должна стоять она —
      // иначе через полгода запись будет врать о том, кто это сказал.
      model: message.model ?? MODEL,
      usage: {
        inputTokens: message.usage?.input_tokens ?? 0,
        outputTokens: message.usage?.output_tokens ?? 0,
      },
    };
  } catch {
    throw new ServiceUnavailableError("Модель вернула некорректный JSON");
  }
}

export const str = (v, max) => String(v ?? "").trim().slice(0, max);

export const list = (arr, max, itemMax) =>
  (Array.isArray(arr) ? arr : [])
    .map((s) => String(s ?? "").trim().slice(0, itemMax))
    .filter(Boolean)
    .slice(0, max);
