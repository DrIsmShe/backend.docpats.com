// server/modules/diagnostics/ai/findings.schema.js
//
// Форма ответа модели — общая для всех анализаторов, и нормализация к ней.
//
// Ключевое требование к схеме: модель ОБЯЗАНА уметь сказать «данных
// недостаточно». Поэтому есть отдельное поле dataGaps и разрешён пустой список
// выводов. Модель, которой некуда деть неуверенность, начинает выдумывать —
// это опаснее молчания.

import { CONFIDENCE_LEVELS, FINDING_SEVERITIES } from "../constants.js";
import { list, str } from "./runner.js";

export const FINDINGS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings", "dataGaps", "summary"],
  properties: {
    summary: {
      type: "string",
      description:
        "Две–три фразы: что видно из материала. Без диагноза как утверждения.",
    },
    findings: {
      type: "array",
      // Лимит НЕ в схеме: API отвергает maxItems (см.
      // common/utils/structuredOutputSchema.js). Просьба — в description,
      // фактическая обрезка — в normalizeFindings ниже.
      description: "Не больше 12 выводов: перечисление всего подряд бесполезно врачу",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "detail", "severity", "confidence"],
        properties: {
          title: { type: "string", description: "Короткая формулировка, на что обратить внимание" },
          detail: { type: "string", description: "Обоснование: на каких данных это основано" },
          severity: {
            type: "string",
            enum: FINDING_SEVERITIES,
            description:
              "critical — требует действий сейчас; important — влияет на тактику; note — стоит учесть",
          },
          confidence: {
            type: "string",
            enum: CONFIDENCE_LEVELS,
            description: "Насколько данных достаточно для этого вывода",
          },
          checklistItem: {
            type: "string",
            description: "Пункт протокола, к которому относится вывод",
          },
          recommendations: {
            type: "array",
            items: { type: "string" },
            description: "Что уточнить, дообследовать, перепроверить. Не больше 5.",
          },
          citations: {
            type: "array",
            description: "Не больше 3 источников",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["source"],
              properties: {
                source: { type: "string", description: "Рекомендация, руководство, критерий" },
                note: { type: "string" },
              },
            },
          },
        },
      },
    },
    dataGaps: {
      type: "array",
      items: { type: "string" },
      description: "Чего не хватает в материале, чтобы судить увереннее. Не больше 8.",
    },
  },
};

/**
 * Нормализация ответа модели.
 *
 * Отдельно стоит объяснить порядок: критические выводы поднимаются наверх
 * принудительно. Модель иногда ставит важное третьим пунктом, а врач читает
 * сверху — и это именно тот случай, когда порядок влияет на исход.
 */
export function normalizeFindings(parsed) {
  const order = { critical: 0, important: 1, note: 2 };

  const findings = (Array.isArray(parsed?.findings) ? parsed.findings : [])
    .map((f) => ({
      title: str(f?.title, 300),
      detail: str(f?.detail, 4000),
      severity: FINDING_SEVERITIES.includes(f?.severity) ? f.severity : "note",
      confidence: CONFIDENCE_LEVELS.includes(f?.confidence) ? f.confidence : "moderate",
      checklistItem: str(f?.checklistItem, 200),
      recommendations: list(f?.recommendations, 5, 500),
      citations: (Array.isArray(f?.citations) ? f.citations : [])
        .map((c) => ({
          source: str(c?.source, 300),
          note: str(c?.note, 500),
          // Ссылку никто не проверял — так и помечаем. Непроверенная ссылка,
          // выданная за проверенную, хуже отсутствия ссылки.
          verified: false,
        }))
        .filter((c) => c.source)
        .slice(0, 3),
    }))
    .filter((f) => f.title)
    .sort((a, b) => order[a.severity] - order[b.severity])
    .slice(0, 12);

  return {
    summary: str(parsed?.summary, 2000),
    findings,
    dataGaps: list(parsed?.dataGaps, 8, 300),
  };
}
