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
      agentResolved: [],
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

/**
 * Закрыть замечания решением АГЕНТА (ai/issueAdjudicator.js).
 *
 * Отличается от setAiReviewDismissed не только источником: там человек
 * нажал кнопку и отчитываться ему не перед кем, здесь машина обязана
 * оставить обоснование по каждому закрытому замечанию. Запись без why не
 * принимается — иначе список выродился бы в тихое «пропустить всё», а
 * именно проверяемость обоснования и позволяет агенту трогать гейт.
 *
 * Отметки человека не затираются: агент их дополняет.
 *
 * @param {object} args
 * @param {import("mongoose").Model} args.CaseModel
 * @param {string} args.caseId
 * @param {Array<{index: number, why: string}>} args.resolved
 * @returns {Promise<{closed: number, unresolved: number}|null>}
 */
export async function resolveAiIssuesByAgent({ CaseModel, caseId, resolved }) {
  const doc = await CaseModel.findById(caseId);
  if (!doc?.aiReview) return null;

  const total = doc.aiReview.issues?.length ?? 0;
  const clean = (resolved ?? [])
    .map((r) => ({ index: Number(r?.index), why: String(r?.why ?? "").trim() }))
    .filter((r) => Number.isInteger(r.index) && r.index >= 0 && r.index < total)
    .filter((r) => r.why);

  if (!clean.length) return { closed: 0, unresolved: unresolvedAiIssues(doc.aiReview).length };

  const byAgent = new Map(
    (doc.aiReview.agentResolved ?? []).map((r) => [Number(r.index), r.why]),
  );
  for (const r of clean) byAgent.set(r.index, r.why);

  doc.aiReview.agentResolved = [...byAgent.entries()]
    .map(([index, why]) => ({ index, why }))
    .sort((a, b) => a.index - b.index);

  doc.aiReview.dismissed = [
    ...new Set([...(doc.aiReview.dismissed ?? []).map(Number), ...clean.map((r) => r.index)]),
  ].sort((a, b) => a - b);

  await doc.save();
  return {
    closed: clean.length,
    unresolved: unresolvedAiIssues(doc.aiReview).length,
  };
}
