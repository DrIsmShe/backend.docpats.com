// server/modules/education/education-ingest/extractors/claude.extractor.js
//
// ИИ-экстрактор: отдаёт PDF или изображение модели Claude и получает
// назад структурированный список вопросов.
//
// Форма ответа гарантирована structured outputs (output_config.format):
// модель физически не может вернуть JSON другой формы, поэтому здесь нет
// эвристического парсинга «а вдруг она обернула ответ в ```json».
//
// Что здесь ВАЖНО помнить:
//   - Результат — ЧЕРНОВИК. Он попадает в draftItems задания импорта, а не
//     в банк вопросов. Публикация возможна только после ревью человеком
//     (гейт в education-items/services/item.service.js).
//   - Ключ ответа модель не угадывает: если в файле его нет, correctKeys
//     приходит пустым, и оператор проставляет ответ руками.

import fs from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import {
  EXTRACTION_JSON_SCHEMA,
  EXTRACTION_SYSTEM_PROMPT,
} from "./extraction.schema.js";
import { resolveFileKind, FILE_KINDS } from "./fileTypes.js";
import { fileToText } from "./fileToText.js";
import {
  ValidationError,
  ServiceUnavailableError,
} from "../../../../common/utils/errors.js";
import logger from "../../../../common/logger.js";

// Opus 4.8 — самая способная модель Opus-линейки; для медицинских
// материалов с таблицами и виньетками точность важнее стоимости прогона.
const MODEL = process.env.EDUCATION_EXTRACTOR_MODEL || "claude-opus-4-8";

// Потолок ответа. Именно он, а не размер файла, ограничивает число
// вопросов за один проход: каждый распознанный вопрос — это ~150–200
// выходных токенов JSON, плюс модель тратит часть бюджета на размышление.
//
// 64k — компромисс: примерно вдвое больше вопросов, чем при 32k, и всё ещё
// далеко от потолка модели (128k). Обязательно со стримом: нестримовый
// запрос с таким max_tokens упрётся в HTTP-таймаут SDK.
const MAX_TOKENS = 64000;

// Ограничение API на размер запроса — 32 МБ вместе с base64-обвязкой.
// Держим запас, чтобы не ловить 413 на границе.
const MAX_FILE_BYTES = 24 * 1024 * 1024;

let cachedClient = null;

/**
 * Чистит ключ из .env.
 *
 * Классическая причина «API key is invalid» при внешне правильном ключе —
 * не сам ключ, а обёртка вокруг него: кавычки, оставшиеся от
 * ANTHROPIC_API_KEY="sk-ant-...", хвостовой пробел или перевод строки при
 * копировании. Такой ключ уходит на сервер как есть и отвергается.
 */
function readApiKey() {
  const raw = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  if (!raw) return null;
  return raw.trim().replace(/^["']|["']$/g, "");
}

function getClient() {
  if (!cachedClient) {
    const apiKey = readApiKey();
    // Передаём ключ явно, а не полагаемся на чтение env внутри SDK:
    // иначе очистка выше не применится.
    //
    // authToken: null — не перестраховка. Если в окружении заданы И
    // ANTHROPIC_API_KEY, И ANTHROPIC_AUTH_TOKEN, SDK подставит оба
    // заголовка (x-api-key и Authorization), а API такой запрос
    // отклоняет с 401 — при полностью валидном ключе.
    cachedClient = apiKey
      ? new Anthropic({ apiKey, authToken: null })
      : new Anthropic();
  }
  return cachedClient;
}

/** Настроен ли экстрактор — проверяется до постановки задания в работу. */
export function isConfigured() {
  return Boolean(readApiKey());
}

/**
 * Переводит ошибку SDK в понятную человеку причину.
 *
 * Показывать администратору сырой JSON от API — то же самое, что не
 * показывать ничего: он не подсказывает, что чинить.
 */
function describeApiError(err) {
  const status = err?.status ?? err?.response?.status ?? null;

  if (err instanceof Anthropic.AuthenticationError || status === 401) {
    return {
      retryable: false,
      message:
        "Ключ Anthropic API отклонён (401). Проверьте ANTHROPIC_API_KEY в .env сервера: " +
        "ключ должен начинаться с «sk-ant-», быть записан без кавычек и лишних пробелов, " +
        "и не быть отозванным. После правки .env нужен pm2 restart all --update-env.",
    };
  }
  if (err instanceof Anthropic.PermissionDeniedError || status === 403) {
    return {
      retryable: false,
      message:
        "У ключа нет доступа к модели (403). Проверьте права ключа в консоли Anthropic.",
    };
  }
  if (err instanceof Anthropic.NotFoundError || status === 404) {
    return {
      retryable: false,
      message: `Модель «${MODEL}» недоступна (404). Проверьте EDUCATION_EXTRACTOR_MODEL в .env.`,
    };
  }
  if (err instanceof Anthropic.RateLimitError || status === 429) {
    return {
      retryable: true,
      message:
        "Превышен лимит запросов к Anthropic API (429). Подождите минуту и повторите загрузку.",
    };
  }
  if (status === 413) {
    return {
      retryable: false,
      message:
        "Файл слишком большой для одного запроса. Разбейте его на части по 20–30 страниц.",
    };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return {
      retryable: true,
      message:
        "Не удалось связаться с Anthropic API — проверьте сеть и исходящие соединения с сервера.",
    };
  }
  if (status && status >= 500) {
    return {
      retryable: true,
      message:
        "Anthropic API временно недоступен. Повторите загрузку через несколько минут.",
    };
  }

  return {
    retryable: false,
    message: `Ошибка обращения к Anthropic API: ${err?.message ?? "неизвестная ошибка"}`,
  };
}

// Собирает контент-блок под тип файла.
//
// API принимает напрямую только PDF (document-блок) и изображения
// (image-блок). Всё остальное — Word, TXT, CSV, HTML, RTF — мы сами
// приводим к тексту и отдаём обычным текстовым блоком. Модели это
// безразлично: она одинаково хорошо читает и распознанную страницу, и
// готовый текст, — а нам дешевле по токенам.
async function buildSourceBlock(bytes, { kind, mediaType, fileName }) {
  if (kind === FILE_KINDS.PDF) {
    return {
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        // base64 без переносов строк — иначе API отвергнет данные.
        data: bytes.toString("base64"),
      },
    };
  }

  if (kind === FILE_KINDS.IMAGE) {
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType ?? "image/png",
        data: bytes.toString("base64"),
      },
    };
  }

  const text = await fileToText(bytes, { kind, fileName });
  // Границы файла обозначаем явно, чтобы модель не спутала содержимое
  // документа с нашей же инструкцией.
  return {
    type: "text",
    text: `<<<НАЧАЛО ФАЙЛА: ${fileName ?? "без имени"}>>>\n${text}\n<<<КОНЕЦ ФАЙЛА>>>`,
  };
}

/**
 * @param {object} args
 * @param {Buffer} [args.buffer]    содержимое файла
 * @param {string} [args.filePath]  путь к файлу, если буфера нет
 * @param {string} args.mimeType
 * @param {string} [args.fileName]  имя файла — по нему определяем тип, если MIME врёт
 * @param {object} args.program     программа: нужны blueprint и языки
 * @param {object} args.defaults    значения по умолчанию задания импорта
 * @returns {Promise<{items: object[], suggestedProgram: object|null, usage: object}>}
 */
export async function extract({
  buffer,
  filePath,
  mimeType,
  fileName,
  program,
  defaults = {},
}) {
  if (!isConfigured()) {
    throw new ServiceUnavailableError(
      "AI extractor is not configured: set ANTHROPIC_API_KEY",
    );
  }

  const bytes = buffer ?? (filePath ? await fs.readFile(filePath) : null);
  if (!bytes) throw new ValidationError("No file content to extract from");
  if (bytes.length > MAX_FILE_BYTES) {
    throw new ValidationError(
      `Файл слишком большой: ${Math.round(bytes.length / 1024 / 1024)} МБ при лимите ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} МБ. Разбейте его на части.`,
    );
  }

  // Бросит ValidationError с конкретным советом, если формат не читается.
  const { kind, mediaType } = resolveFileKind({ mimeType, fileName });

  // Подсказка по темам: даём модели коды blueprint, чтобы она разложила
  // вопросы по темам сразу. Неизвестный код мы всё равно отбросим в
  // сервисе, так что риск здесь нулевой.
  const topicHint = (program?.blueprint ?? [])
    .map((s) => `- ${s.code}: ${s.title}`)
    .join("\n");

  const instruction = [
    `Программа: ${program?.title ?? "не указана"}.`,
    // Язык из формы — предположение оператора (по умолчанию "ru"), а не
    // факт. Подаём его именно как предположение: иначе модель подгоняет
    // под него suggestedProgram.lang и азербайджанский файл уезжает в
    // каталог как русский.
    defaults.lang
      ? `Оператор предположил, что материал на языке "${defaults.lang}" — проверь это по тексту и верни в suggestedProgram.lang фактический язык вопросов.`
      : null,
    topicHint
      ? `Разделы программы (проставь topicCode, если тема очевидна; иначе оставь пустым):\n${topicHint}`
      : null,
    "Извлеки из файла все тестовые вопросы.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const client = getClient();
  const sourceBlock = await buildSourceBlock(bytes, {
    kind,
    mediaType,
    fileName,
  });

  let message;
  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Адаптивное мышление: разбор многостраничной таблицы с вопросами —
      // ровно тот случай, где модель должна подумать перед ответом.
      thinking: { type: "adaptive" },
      system: EXTRACTION_SYSTEM_PROMPT,
      output_config: {
        format: { type: "json_schema", schema: EXTRACTION_JSON_SCHEMA },
      },
      messages: [
        {
          role: "user",
          // Файл идёт ПЕРЕД текстом инструкции — так модель точнее
          // связывает задание с документом.
          content: [sourceBlock, { type: "text", text: instruction }],
        },
      ],
    });
    message = await stream.finalMessage();
  } catch (err) {
    const described = describeApiError(err);
    logger?.error?.(
      {
        err,
        model: MODEL,
        mimeType,
        status: err?.status ?? null,
        retryable: described.retryable,
      },
      "AI extraction request failed",
    );
    // Проблема конфигурации — это не «сервис недоступен»: 503 подтолкнёт
    // администратора ждать, вместо того чтобы починить ключ.
    throw described.retryable
      ? new ServiceUnavailableError(described.message)
      : new ValidationError(described.message);
  }

  // Модель может отказаться обрабатывать материал — это штатный ответ
  // с HTTP 200, а не исключение. Проверяем ДО чтения content.
  if (message.stop_reason === "refusal") {
    throw new ValidationError(
      "AI extractor declined to process this file",
      { category: message.stop_details?.category ?? null },
    );
  }
  if (message.stop_reason === "max_tokens") {
    // Ответ обрезан на середине — распознанное отдавать нельзя, последний
    // вопрос заведомо неполный, а JSON невалиден.
    throw new ValidationError(
      "В файле слишком много вопросов для одного прохода: ответ модели не поместился в лимит. " +
        "Разбейте файл на части по 20–40 страниц и загрузите их по очереди — " +
        "вопросы из всех частей можно складывать в один и тот же тест.",
    );
  }

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock) {
    throw new ServiceUnavailableError("AI extractor returned no content");
  }

  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    // При structured outputs это не должно происходить; если случилось —
    // молча глотать нельзя, иначе задание «успешно» завершится пустым.
    throw new ServiceUnavailableError(
      "AI extractor returned malformed JSON despite the schema constraint",
    );
  }

  return {
    items: Array.isArray(parsed.items) ? parsed.items : [],
    // Предложенная структура теста. Применяется только к пустой программе —
    // решение принимает ingest.service, экстрактор просто передаёт данные.
    suggestedProgram: parsed.suggestedProgram ?? null,
    usage: {
      inputTokens: message.usage?.input_tokens ?? 0,
      outputTokens: message.usage?.output_tokens ?? 0,
    },
  };
}

export default { name: "claude", isConfigured, extract };
