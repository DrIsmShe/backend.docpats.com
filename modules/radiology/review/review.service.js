// server/modules/radiology/review/review.service.js
//
// Интервальное повторение арены. Работает на всех трёх станциях (снимки,
// «Анализы», «Виртуальный пациент») — элемент очереди помечен полем station.
// Раньше очередь была только у снимков, и на двух других станциях «работа
// над ошибками» просто отсутствовала.
//
// Обновляется на сдаче попытки: слабый результат кладёт кейс на повторение,
// уверенный — двигает интервал, освоенный — убирает из очереди.
//
// ВАЖНО: очередь двигают только ЗАЧЁТНЫЕ попытки (mode=exam). Тренировка
// оставляет очередь в покое намеренно: иначе можно было бы «закрыть» кейс
// тренировочным прогоном сразу после разбора, где показан правильный ответ,
// и повторение перестало бы работать по назначению. Вызывающая сторона
// решает это сама — здесь мы верим переданному флагу.

import RadiologyReviewItem from "./models/radiologyReviewItem.model.js";

const DAY = 86400000;
const BOX_DAYS = { 1: 1, 2: 3, 3: 7 }; // ступень → дней до следующего показа
const MAX_BOX = 3;

export const REVIEW_STATIONS = ["radiology", "labs", "vp"];

/**
 * Обновляет очередь повторения по итогу попытки. Тихо и идемпотентно.
 * @param {object} a
 * @param {string} [a.station] radiology | labs | vp
 * @param {boolean} a.passed   сдан ли кейс
 * @param {number} a.missed    сколько находок/пунктов пропущено
 */
export async function updateReviewItem({
  userId,
  caseId,
  caseTitle,
  modality = "",
  station = "radiology",
  score,
  passed,
  missed,
}) {
  const weak = !passed || missed > 0;
  const item = await RadiologyReviewItem.findOne({ userId, caseId, station });
  const now = Date.now();

  if (weak) {
    // Слабый результат — на повторение через день, ступень сбрасываем.
    if (item) {
      item.box = 1;
      item.dueAt = new Date(now + BOX_DAYS[1] * DAY);
      item.lastScore = score;
      item.caseTitle = caseTitle;
      item.modality = modality;
      await item.save();
    } else {
      await RadiologyReviewItem.create({
        userId,
        caseId,
        station,
        caseTitle,
        modality,
        box: 1,
        dueAt: new Date(now + BOX_DAYS[1] * DAY),
        lastScore: score,
      });
    }
    return;
  }

  // Уверенно сдал. Если кейс не был в очереди — ничего не заводим.
  if (!item) return;
  if (item.box >= MAX_BOX) {
    // Освоил на максимальной ступени — убираем из очереди.
    await RadiologyReviewItem.deleteOne({ _id: item._id });
    return;
  }
  item.box += 1;
  item.dueAt = new Date(now + BOX_DAYS[item.box] * DAY);
  item.lastScore = score;
  await item.save();
}

function stationFilter(station) {
  return station && REVIEW_STATIONS.includes(station) ? { station } : {};
}

/** Кейсы, которые пора повторить (срок наступил). */
export async function listDue(userId, station = null) {
  return RadiologyReviewItem.find({
    userId,
    ...stationFilter(station),
    dueAt: { $lte: new Date() },
  })
    .sort({ dueAt: 1 })
    .limit(50)
    .lean();
}

/** Вся очередь повторения (включая ещё не наступившие сроки). */
export async function listAll(userId, station = null) {
  return RadiologyReviewItem.find({ userId, ...stationFilter(station) })
    .sort({ dueAt: 1 })
    .limit(100)
    .lean();
}

export async function countDue(userId, station = null) {
  return RadiologyReviewItem.countDocuments({
    userId,
    ...stationFilter(station),
    dueAt: { $lte: new Date() },
  });
}
