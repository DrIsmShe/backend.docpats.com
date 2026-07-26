// server/modules/radiology/ai/aiReviewStore.js
//
// Сохранение ИИ-рецензии в кейсе и отметок «разобрано» — общий код для трёх
// станций (модель передаётся аргументом).
//
// Почему рецензия сохраняется сервером, а не присылается клиентом: список
// замечаний — то, на чём стоит гейт публикации. Принимать его из браузера
// значило бы позволить отправить пустой список и опубликовать что угодно.
// Клиент присылает только id кейса, а текст рецензии берётся из того, что
// сервер сам сейчас посчитал.

import { MODEL } from "./aiRunner.js";
import { unresolvedAiIssues } from "./aiReviewFields.js";

/**
 * Записать в кейс только что посчитанную рецензию. Отметки «разобрано»
 * сбрасываются: новая рецензия — новый список, и старые номера указывали бы
 * на другие замечания.
 *
 * Тихая: сбой сохранения не должен ронять ответ с рецензией — автор всё
 * равно увидит замечания на экране, просто гейт останется мягким до
 * следующей проверки.
 */
export async function saveAiReview({ CaseModel, caseId, review }) {
  if (!caseId || !review) return null;
  try {
    const doc = await CaseModel.findById(caseId);
    if (!doc) return null;
    doc.aiReview = {
      verdict: review.verdict,
      issues: review.issues ?? [],
      errorCount: review.errorCount ?? 0,
      summary: review.summary ?? "",
      model: MODEL,
      generatedAt: new Date(),
      dismissed: [],
    };
    await doc.save();
    return doc.aiReview;
  } catch {
    return null;
  }
}

/**
 * Обновить отметки «разобрано». Индексы вне списка замечаний отбрасываем —
 * иначе гейт можно было бы обойти, прислав номера, которых нет.
 */
export async function setAiReviewDismissed({ CaseModel, caseId, dismissed }) {
  const doc = await CaseModel.findById(caseId);
  if (!doc) return null;
  const total = doc.aiReview?.issues?.length ?? 0;
  doc.aiReview.dismissed = [...new Set((dismissed ?? []).map(Number))]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < total)
    .sort((a, b) => a - b);
  await doc.save();
  return {
    ...doc.aiReview.toObject?.() ?? doc.aiReview,
    unresolved: unresolvedAiIssues(doc.aiReview).length,
  };
}
