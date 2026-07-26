// server/modules/radiology/ai/aiReviewFields.js
//
// СОХРАНЁННАЯ ИИ-РЕЦЕНЗИЯ кейса (второй проход) — общая для трёх станций.
//
// Зачем хранить, а не держать в состоянии формы: гейт публикации опирается
// на разбор замечаний, а состояние React живёт до перезагрузки страницы.
// Автор мог нажать F5 и опубликовать кейс с неразобранными замечаниями —
// гейт был мягким. Теперь замечания и отметки «разобрано» лежат в кейсе, и
// проверка идёт на сервере, при смене статуса.
//
// dismissed — индексы замечаний, которые автор отметил как разобранные.
// Индексы, а не копии текстов: список замечаний неизменяем (его заменяет
// целиком новая рецензия), а сравнивать длинные строки — лишний источник
// расхождений. При новой рецензии отметки сбрасываются, иначе «разобрано»
// перенеслось бы на другое замечание с тем же номером.
//
// Замечание рецензента может быть и неверным — модель ошибается. Поэтому
// «разобрано» ставит человек, и это не ложь: автор посмотрел и решил. Гейт
// требует не согласия с ИИ, а того, чтобы каждое замечание было прочитано.

import mongoose from "mongoose";
import { ISSUE_SEVERITIES } from "../constants.js";

const { Schema } = mongoose;

const issueSchema = new Schema(
  {
    target: { type: String, default: "" },
    severity: { type: String, enum: ISSUE_SEVERITIES, default: "warning" },
    issue: { type: String, default: "" },
    suggestion: { type: String, default: "" },
  },
  { _id: false },
);

export function aiReviewField() {
  return {
    aiReview: {
      verdict: { type: String, enum: ["clean", "issues"], default: null },
      issues: { type: [issueSchema], default: [] },
      errorCount: { type: Number, default: 0 },
      summary: { type: String, default: "" },
      model: { type: String, default: "" },
      generatedAt: { type: Date, default: null },
      // Индексы разобранных замечаний.
      dismissed: { type: [Number], default: [] },
    },
  };
}

/**
 * Неразобранные замечания сохранённой рецензии. Блокируют публикацию —
 * ВСЕ, а не только severity=error: калибровка на 11 кейсах показала, что
 * модель систематически занижает серьёзность (противопоказанный препарат
 * помечался warning), и пытаться исправить это промптом не получилось.
 * Поэтому серьёзность влияет только на порядок показа.
 */
export function unresolvedAiIssues(aiReview) {
  const issues = aiReview?.issues ?? [];
  if (!issues.length) return [];
  const dismissed = new Set((aiReview.dismissed ?? []).map(Number));
  return issues.filter((_, index) => !dismissed.has(index));
}
