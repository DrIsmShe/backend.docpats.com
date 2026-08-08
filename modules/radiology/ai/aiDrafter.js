// server/modules/radiology/ai/aiDrafter.js
//
// ИИ-помощник авторинга: отдаёт снимок модели Claude (vision) и получает
// назад СТРУКТУРИРОВАННЫЙ ЧЕРНОВИК кейса — клинический контекст, находки с
// точками-локализациями, эталонное заключение и ключи диагноза.
//
// Философия — та же, что у ИИ-импорта education: это ЧЕРНОВИК для эксперта,
// а не готовый кейс. Ничего не публикуется автоматически: автор проверяет и
// правит разметку на холсте, а публикация всё равно проходит гейт ревью.
//
// Ключ/клиент Anthropic переиспользуем из education-экстрактора, чтобы не
// дублировать обработку «invalid API key» и не ловить те же баги дважды.

import {
  getClient,
  describeApiError,
} from "../../education/education-ingest/extractors/claude.extractor.js";
import { findingsForModality } from "../lexicon/lexicon.js";
import {
  ValidationError,
  ServiceUnavailableError,
} from "../../../common/utils/errors.js";
import logger from "../../../common/logger.js";
// Загрузка кадра общая с рецензентом: снимок смотрят оба.
import { fetchImage } from "./aiRunner.js";

const MODEL =
  process.env.RADIOLOGY_AI_MODEL ||
  process.env.EDUCATION_EXTRACTOR_MODEL ||
  "claude-opus-4-8";

const clamp01 = (x) =>
  typeof x === "number" ? Math.max(0, Math.min(1, x)) : 0.5;

/** Настроен ли ИИ-помощник (тот же ключ, что у ИИ-импорта). */
export function isConfigured() {
  return Boolean(
    (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "").trim(),
  );
}


// Общая обработка ответа модели: отказ / обрезка / парсинг JSON.
function parseModelJson(message, describeApiError) {
  if (message.stop_reason === "refusal") {
    throw new ValidationError("ИИ отказался обрабатывать этот снимок");
  }
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock) throw new ServiceUnavailableError("ИИ вернул пустой ответ");
  try {
    return JSON.parse(textBlock.text);
  } catch {
    throw new ServiceUnavailableError("ИИ вернул некорректный JSON");
  }
}

// Форма ответа гарантируется structured outputs. Числовые ограничения
// (min/max) схема structured outputs не поддерживает — держим их только в
// описаниях, а координаты клампим уже на нашей стороне.
export const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "clinicalContext", "difficulty", "findings", "impression"],
  properties: {
    // Сложность оценивает тот же проход, что и смотрит на снимок: отдельного
    // сигнала для неё нет, а оставлять автору ещё одно поле для ручной
    // правки — ровно то, от чего кнопка «собрать целиком» избавляет.
    difficulty: {
      type: "string",
      enum: ["easy", "medium", "hard"],
      description:
        "Насколько трудно найти и назвать патологию на ЭТОМ снимке: easy — видно сразу, " +
        "medium — нужно знать, где смотреть, hard — тонкий признак или нетипичная картина.",
    },
    title: {
      type: "string",
      description: "Краткое учебное название кейса по картине снимка.",
    },
    clinicalContext: {
      type: "string",
      description:
        "Правдоподобный УЧЕБНЫЙ клинический контекст (жалобы, анамнез), согласующийся с картиной. Обобщённый, не про конкретного реального пациента.",
    },
    findings: {
      type: "array",
      description:
        "Патологические находки, ВИДНЫЕ на снимке. Если снимок в норме — верни одну находку с label 'normal'. Не выдумывай того, чего не видно.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "significance", "point", "explanation"],
        properties: {
          label: {
            type: "string",
            description:
              "Код находки СТРОГО из списка допустимых кодов (дан в инструкции). Иначе не включай находку.",
          },
          significance: {
            type: "string",
            enum: ["critical", "major", "incidental"],
          },
          point: {
            type: "object",
            additionalProperties: false,
            required: ["x", "y"],
            properties: {
              x: { type: "number", description: "Доля ширины кадра, 0..1 (центр находки)." },
              y: { type: "number", description: "Доля высоты кадра, 0..1 (центр находки)." },
            },
          },
          explanation: {
            type: "string",
            description: "Почему это патология — 1–2 предложения для разбора.",
          },
        },
      },
    },
    impression: {
      type: "object",
      additionalProperties: false,
      required: ["correctText", "diagnosisKeys", "diagnosisSynonyms"],
      properties: {
        correctText: {
          type: "string",
          description: "Образцовое рентгенологическое заключение по снимку.",
        },
        diagnosisKeys: {
          type: "array",
          description:
            "Принятые термины диагноза простыми словами (учащийся вводит текстом): напр. 'пневмоторакс', 'pneumothorax'.",
          items: { type: "string" },
        },
        diagnosisSynonyms: {
          type: "array",
          description: "Синонимы диагноза для оценки свободного текста.",
          items: { type: "string" },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `Ты — ассистент врача-рентгенолога, который помогает СОСТАВИТЬ ЧЕРНОВИК учебного кейса по присланному медицинскому снимку. Результат проверит и поправит эксперт-человек, поэтому твоя задача — дать аккуратную заготовку, а не окончательный диагноз.

Жёсткие правила:
1. ОПИСЫВАЙ ТОЛЬКО ТО, ЧТО ВИДНО. Не выдумывай находки. Если снимок без явной патологии — верни одну находку с label "normal".
2. Каждую находку локализуй ТОЧКОЙ в долях кадра: x и y от 0 до 1 (0,0 — левый верх). Ставь точку в ЦЕНТР находки.
3. label бери СТРОГО из списка допустимых кодов, данных в инструкции. Находку с кодом не из списка не включай.
4. significance: critical — жизнеугрожающее (пневмоторакс, свободный газ), major — клинически значимое, incidental — случайная малозначимая.
5. Клинический контекст — учебный и обобщённый, согласованный с картиной; не приписывай данные конкретного реального пациента.
6. Это ЧЕРНОВИК: пиши уверенно, но помни, что финальное слово за экспертом. Не отказывайся помочь с учебным материалом по обезличенному снимку.

Ответ верни строго в заданной JSON-структуре.`;

/**
 * @param {object} args
 * @param {string} args.imageUrl   публичный URL снимка (R2 или локальная статика)
 * @param {string} args.modality   модальность кейса (для списка допустимых находок)
 * @param {string} [args.hint]     необязательная подсказка автора
 * @param {number} [args.imageIndex] к какому кадру привязать находки (по умолчанию 0)
 */
export async function draftCase({ imageUrl, modality, hint, imageIndex = 0 }) {
  if (!isConfigured()) {
    throw new ServiceUnavailableError(
      "ИИ-помощник не настроен: задайте ANTHROPIC_API_KEY в .env сервера",
    );
  }
  if (!imageUrl) throw new ValidationError("Нет снимка для анализа");

  const { bytes, mediaType } = await fetchImage(imageUrl);
  const allowed = findingsForModality(modality);
  const known = new Set(allowed.map((t) => t.key));
  const labelList = allowed.map((t) => `- ${t.key}: ${t.label}`).join("\n");

  const instruction = [
    `Модальность снимка: ${modality}.`,
    hint ? `Подсказка автора (учти, но проверь по снимку): ${hint}` : null,
    `Допустимые коды находок:\n${labelList}`,
    "Составь черновик кейса по этому снимку.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const client = getClient();
  let message;
  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      output_config: {
        format: { type: "json_schema", schema: DRAFT_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: bytes.toString("base64") },
            },
            { type: "text", text: instruction },
          ],
        },
      ],
    });
    message = await stream.finalMessage();
  } catch (err) {
    const described = describeApiError(err);
    logger?.error?.(
      { err, model: MODEL, status: err?.status ?? null },
      "radiology AI draft request failed",
    );
    throw described.retryable
      ? new ServiceUnavailableError(described.message)
      : new ValidationError(described.message);
  }

  if (message.stop_reason === "refusal") {
    throw new ValidationError("ИИ отказался обрабатывать этот снимок");
  }
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock) throw new ServiceUnavailableError("ИИ вернул пустой ответ");

  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    throw new ServiceUnavailableError("ИИ вернул некорректный JSON");
  }

  // Нормализуем: коды находок принимаем только из словаря модальности,
  // координаты клампим в 0..1, всё привязываем к активному кадру.
  const findings = (Array.isArray(parsed.findings) ? parsed.findings : [])
    .filter((f) => known.has(f.label))
    .map((f, i) => ({
      key: `ai_${Date.now().toString(36)}_${i}`,
      imageIndex,
      label: f.label,
      significance: ["critical", "major", "incidental"].includes(f.significance)
        ? f.significance
        : "major",
      geometry: {
        shape: "point",
        coords: { x: clamp01(f.point?.x), y: clamp01(f.point?.y) },
      },
      explanation: String(f.explanation ?? "").slice(0, 2000),
    }));

  return {
    title: String(parsed.title ?? "").slice(0, 300),
    clinicalContext: String(parsed.clinicalContext ?? "").slice(0, 4000),
    // Неизвестное значение приводим к medium, а не роняем черновик: сложность
    // автор в любом случае видит и может поправить одним щелчком.
    difficulty: ["easy", "medium", "hard"].includes(parsed.difficulty)
      ? parsed.difficulty
      : "medium",
    findings,
    impression: {
      correctText: String(parsed.impression?.correctText ?? "").slice(0, 4000),
      diagnosisKeys: (parsed.impression?.diagnosisKeys ?? [])
        .map((s) => String(s).trim())
        .filter(Boolean)
        .slice(0, 20),
      diagnosisSynonyms: (parsed.impression?.diagnosisSynonyms ?? [])
        .map((s) => String(s).trim())
        .filter(Boolean)
        .slice(0, 50),
    },
    usage: {
      inputTokens: message.usage?.input_tokens ?? 0,
      outputTokens: message.usage?.output_tokens ?? 0,
    },
  };
}

// ─── ИИ-разбор попытки учащегося ──────────────────────────────────────
// ИИ имеет право скорректировать ответ врача, поставить диагноз и написать
// текст заключения и разбора. Опирается на снимок + эталон эксперта + ответ
// учащегося. Это учебный разбор поверх детерминированной оценки, а не
// замена ей: баллы считает scoring.service, а здесь — «врач-преподаватель».

export const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["diagnosis", "conclusion", "analysis"],
  properties: {
    diagnosis: {
      type: "string",
      description: "Наиболее вероятный диагноз по снимку, кратко.",
    },
    conclusion: {
      type: "string",
      description:
        "Грамотное рентгенологическое заключение по снимку — как в протоколе описания.",
    },
    analysis: {
      type: "string",
      description:
        "Разбор ответа учащегося на «ты»/«вы» по-русски: что он нашёл верно, что упустил, что назвал неверно, и как читать такой снимок правильно. Доброжелательно и конкретно.",
    },
  },
};

const ANALYSIS_SYSTEM = `Ты — опытный врач-рентгенолог и преподаватель. Тебе дан медицинский снимок, ЭТАЛОН (находки и заключение эксперта) и ОТВЕТ УЧАЩЕГОСЯ. Твоя задача — разобрать ответ учащегося как наставник.

Правила:
1. Ты имеешь право поставить диагноз, написать грамотное заключение и скорректировать ответ учащегося.
2. Опирайся на эталон эксперта. Если эталон неполон — дополни по снимку, но не противоречь ему без веской причины.
3. В разборе честно укажи: что учащийся нашёл верно, что пропустил, что назвал или локализовал неверно, и как правильно читать такой снимок.
4. Пиши по-русски, по существу, доброжелательно. Без воды.

Ответ верни строго в заданной JSON-структуре.`;

/**
 * @param {object} args
 * @param {string} args.imageUrl       снимок (первый/ключевой кадр кейса)
 * @param {string} args.promptContext  готовый текст: контекст кейса, эталон, ответ учащегося
 * @returns {Promise<{diagnosis:string, conclusion:string, analysis:string, usage:object}>}
 */
export async function analyzeAttempt({ imageUrl, promptContext }) {
  if (!isConfigured()) {
    throw new ServiceUnavailableError(
      "ИИ-разбор не настроен: задайте ANTHROPIC_API_KEY в .env сервера",
    );
  }
  if (!imageUrl) throw new ValidationError("Нет снимка для разбора");

  const { bytes, mediaType } = await fetchImage(imageUrl);
  const client = getClient();

  let message;
  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      system: ANALYSIS_SYSTEM,
      output_config: { format: { type: "json_schema", schema: ANALYSIS_SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: bytes.toString("base64") },
            },
            { type: "text", text: String(promptContext ?? "") },
          ],
        },
      ],
    });
    message = await stream.finalMessage();
  } catch (err) {
    const described = describeApiError(err);
    logger?.error?.(
      { err, model: MODEL, status: err?.status ?? null },
      "radiology AI analysis failed",
    );
    throw described.retryable
      ? new ServiceUnavailableError(described.message)
      : new ValidationError(described.message);
  }

  const parsed = parseModelJson(message, describeApiError);
  return {
    diagnosis: String(parsed.diagnosis ?? "").slice(0, 2000),
    conclusion: String(parsed.conclusion ?? "").slice(0, 4000),
    analysis: String(parsed.analysis ?? "").slice(0, 6000),
    usage: {
      inputTokens: message.usage?.input_tokens ?? 0,
      outputTokens: message.usage?.output_tokens ?? 0,
    },
  };
}
