// server/modules/radiology/radiology-attempts/services/caseStats.service.js
//
// Статистика кейса — одна на три станции. Смысл разделения счётчиков:
//
//   attempts        — все сдачи, включая тренировки. Показывает трафик.
//   countedAttempts — только ПЕРВЫЕ зачётные попытки каждого врача.
//   avgScore        — среднее по countedAttempts, а не по всем сдачам.
//
// Почему так: средний балл по всем попыткам подряд врал автору. Повторное
// прохождение идёт уже после разбора, где показан эталон, и даёт почти
// максимум. Пара таких повторов превращала трудный кейс в «лёгкий» на
// глазах, и калибровать сложность по этой цифре было нельзя — а больше она
// ни для чего и не нужна.
//
// avgDurationMs считается по тем же первым зачётным: это база для сигнала
// «сдал подозрительно быстро» (integrity.service.js). По тренировкам её
// считать бессмысленно — там никто не торопится.

/**
 * @param {object} a
 * @param {import("mongoose").Model} a.CaseModel
 * @param {string} a.caseId
 * @param {number} a.total          балл попытки 0..1
 * @param {boolean} a.isFirstCounted первая зачётная попытка врача по кейсу
 * @param {number|null} [a.durationMs]
 */
export async function recordCaseStats({
  CaseModel,
  caseId,
  total,
  isFirstCounted = false,
  durationMs = null,
}) {
  const doc = await CaseModel.findById(caseId).select("stats");
  if (!doc) return;

  doc.stats.attempts = (doc.stats.attempts ?? 0) + 1;

  if (isFirstCounted) {
    const n = doc.stats.countedAttempts ?? 0;
    const avg = doc.stats.avgScore ?? 0;
    doc.stats.countedAttempts = n + 1;
    doc.stats.avgScore = (avg * n + (total ?? 0)) / (n + 1);

    if (durationMs > 0) {
      const prev = doc.stats.avgDurationMs;
      doc.stats.avgDurationMs =
        prev > 0 ? (prev * n + durationMs) / (n + 1) : durationMs;
    }
  }

  await doc.save();
}
