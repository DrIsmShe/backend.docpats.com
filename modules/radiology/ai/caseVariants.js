// server/modules/radiology/ai/caseVariants.js
//
// ИИ-генерация ЧИСЛОВЫХ ВАРИАНТОВ кейса: тот же диагноз, другие значения.
// Автор нажимает кнопку, получает 2–4 варианта и правит их как обычные данные.
//
// Главное ограничение, которое здесь навязывается модели и проверяется кодом:
// вариант может менять ТОЛЬКО значения существующих показателей/результатов.
// Ни новых ключей, ни другого диагноза, ни изменения списка нужных
// обследований. Иначе это был бы другой кейс: разбор, статистика и эталон
// перестали бы к нему относиться, а автор об этом узнал бы от учащихся.
//
// Поэтому нормализация фильтрует ключи по кейсу, а вариант без единого
// осмысленного изменения отбрасывается — пустой «вариант» хуже отсутствующего:
// он создаёт видимость разнообразия.

import { runJson, str, list, MODEL, isConfigured } from "./aiRunner.js";
import { ValidationError } from "../../../common/utils/errors.js";

export { isConfigured };

const LAB_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["variants"],
  properties: {
    variants: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "panel", "significantAbnormal"],
        properties: {
          label: { type: "string", description: "Короткая подпись варианта, напр. «Вариант Б»" },
          note: { type: "string", description: "Чем этот вариант отличается клинически" },
          panel: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["key", "value"],
              properties: {
                key: { type: "string", description: "Ключ показателя ИЗ СПИСКА кейса" },
                value: { type: "string" },
                unit: { type: "string" },
                refRange: { type: "string" },
              },
            },
          },
          significantAbnormal: {
            type: "array",
            items: { type: "string", description: "Ключи значимо отклонённых показателей этого варианта" },
          },
        },
      },
    },
  },
};

const VP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["variants"],
  properties: {
    variants: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "presentation", "results"],
        properties: {
          label: { type: "string" },
          note: { type: "string" },
          presentation: { type: "string", description: "Жалоба и анамнез этого варианта" },
          results: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["key", "resultText"],
              properties: {
                key: { type: "string", description: "Ключ обследования ИЗ СПИСКА кейса" },
                resultText: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
};

const SYSTEM = [
  "Ты клинический эксперт, который готовит числовые варианты одной учебной задачи.",
  "Диагноз во всех вариантах ОДИН И ТОТ ЖЕ — меняются только значения и формулировки.",
  "Значения обязаны оставаться клинически правдоподобными и согласованными между собой:",
  "вариант с другой цифрой гемоглобина должен иметь согласованные с ней остальные показатели.",
  "Используй ТОЛЬКО ключи, перечисленные во входных данных. Новых не придумывай.",
  "Пиши по-русски.",
].join(" ");

function clampCount(count) {
  const n = Number(count) || 2;
  return Math.max(1, Math.min(4, Math.round(n)));
}

/**
 * Варианты для станции «Анализы».
 * @returns {Promise<Array<{label,note,panel,significantAbnormal}>>}
 */
export async function generateLabVariants(caseDoc, count = 2) {
  const panel = caseDoc.panel ?? [];
  if (panel.length < 2) {
    throw new ValidationError("Для вариантов нужна панель хотя бы из 2 показателей");
  }
  const keys = new Set(panel.map((p) => p.key));

  const instruction = [
    `Диагноз (неизменный): ${(caseDoc.impression?.diagnosisKeys ?? []).join(", ") || caseDoc.title}`,
    caseDoc.clinicalContext ? `Клинический контекст: ${str(caseDoc.clinicalContext, 2000)}` : null,
    "",
    "Показатели кейса (ключ — название — текущее значение — референс):",
    ...panel.map(
      (p) =>
        `- ${p.key} — ${p.name} — ${p.value}${p.unit ? " " + p.unit : ""} — ${p.refRange || "—"}`,
    ),
    `Значимо отклонены сейчас: ${(caseDoc.significantAbnormal ?? []).join(", ") || "не указано"}`,
    "",
    `Сделай ${clampCount(count)} вариант(ов) той же задачи: другие значения, тот же диагноз.`,
    "Для каждого варианта укажи, какие показатели в нём значимо отклонены.",
    "Достаточно менять значения тех показателей, где это осмысленно.",
  ]
    .filter(Boolean)
    .join("\n");

  const { parsed } = await runJson({
    system: SYSTEM,
    instruction,
    schema: LAB_SCHEMA,
    maxTokens: 12000,
    what: "варианты кейса",
  });

  return normalizeLabVariants(parsed.variants, keys);
}

/** Нормализация: чужие ключи выбрасываем, пустые варианты не сохраняем. */
export function normalizeLabVariants(raw, allowedKeys) {
  const keys = allowedKeys instanceof Set ? allowedKeys : new Set(allowedKeys ?? []);
  return (Array.isArray(raw) ? raw : [])
    .map((v, i) => {
      const panel = (Array.isArray(v?.panel) ? v.panel : [])
        .filter((p) => keys.has(String(p?.key ?? "")))
        .map((p) => ({
          key: str(p.key, 40),
          value: str(p.value, 60),
          unit: str(p.unit, 40),
          refRange: str(p.refRange, 60),
        }))
        .filter((p) => p.value);
      return {
        label: str(v?.label, 60) || `Вариант ${i + 1}`,
        note: str(v?.note, 500),
        panel,
        significantAbnormal: list(v?.significantAbnormal, 40, 40).filter((k) => keys.has(k)),
      };
    })
    // Вариант без изменённых значений — это не вариант.
    .filter((v) => v.panel.length > 0)
    .slice(0, 4);
}

/**
 * Варианты для «Виртуального пациента».
 * @returns {Promise<Array<{label,note,presentation,results}>>}
 */
export async function generateVpVariants(caseDoc, count = 2) {
  const invs = caseDoc.investigations ?? [];
  if (invs.length < 2) {
    throw new ValidationError("Для вариантов нужно хотя бы 2 обследования");
  }
  const keys = new Set(invs.map((i) => i.key));

  const instruction = [
    `Диагноз (неизменный): ${(caseDoc.diagnosis?.diagnosisKeys ?? []).join(", ") || caseDoc.title}`,
    `Жалоба и анамнез сейчас: ${str(caseDoc.presentation, 2000) || "—"}`,
    "",
    "Обследования кейса (ключ — название — текущий результат — нужное?):",
    ...invs.map(
      (i) =>
        `- ${i.key} — ${i.name} — ${str(i.resultText, 300) || "—"} — ${i.necessary ? "нужное" : "лишнее"}`,
    ),
    "",
    `Сделай ${clampCount(count)} вариант(ов) того же сценария: другой пациент с тем же диагнозом.`,
    "Меняй возраст/пол/детали жалобы и числовые результаты, но не меняй,",
    "какие обследования нужны: врач должен приходить к тому же набору.",
  ].join("\n");

  const { parsed } = await runJson({
    system: SYSTEM,
    instruction,
    schema: VP_SCHEMA,
    maxTokens: 12000,
    what: "варианты сценария",
  });

  return normalizeVpVariants(parsed.variants, keys);
}

export function normalizeVpVariants(raw, allowedKeys) {
  const keys = allowedKeys instanceof Set ? allowedKeys : new Set(allowedKeys ?? []);
  return (Array.isArray(raw) ? raw : [])
    .map((v, i) => {
      const results = (Array.isArray(v?.results) ? v.results : [])
        .filter((r) => keys.has(String(r?.key ?? "")))
        .map((r) => ({ key: str(r.key, 40), resultText: str(r.resultText, 4000) }))
        .filter((r) => r.resultText);
      return {
        label: str(v?.label, 60) || `Вариант ${i + 1}`,
        note: str(v?.note, 500),
        presentation: str(v?.presentation, 4000),
        results,
      };
    })
    .filter((v) => v.results.length > 0 || v.presentation)
    .slice(0, 4);
}

export const VARIANTS_MODEL = MODEL;
