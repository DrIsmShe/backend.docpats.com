// server/modules/radiology/radiology-attempts/services/scoring.service.js
//
// Детерминированный движок оценки чтения снимка. Считается на сервере без
// ИИ — это «ключ ответа» модуля, аналог проверки correctKeys в education.
// Свободный текст заключения оценивается отдельно (impressionGrader.js) и
// подмешивается как ещё один компонент — гибрид, о котором договорились.
//
// Компоненты оценки (каждый 0..1):
//   detection      — нашёл ли находки там, где они есть (взвешено по
//                    значимости; ложные тревоги штрафуют);
//   classification — верно ли назвал найденное;
//   checklist      — прошёл ли протокол систематического осмотра целиком;
//   diagnosis      — верный ли итоговый диагноз.
//
// Локализация оценивается по расстоянию между центрами разметки, а не
// пиксель-в-пиксель: учим «увидел в нужной зоне», а не «обвёл идеально».
// Порог совпадения (matchRadius) задаёт система чтения модальности.

import { SIGNIFICANCE_WEIGHT } from "../../constants.js";

// ─── Геометрия ────────────────────────────────────────────────────────
// Центр разметки в нормализованных координатах (0..1). Форму coords
// гарантирует zod-валидатор на входе, поэтому здесь читаем поля напрямую.
export function shapeCenter(shape, coords) {
  switch (shape) {
    case "point":
      return { x: coords.x, y: coords.y };
    case "rect":
      return { x: coords.x + coords.w / 2, y: coords.y + coords.h / 2 };
    case "ellipse":
      return { x: coords.cx, y: coords.cy };
    case "polygon": {
      const pts = Array.isArray(coords.points) ? coords.points : [];
      if (pts.length === 0) return { x: 0, y: 0 };
      const sum = pts.reduce(
        (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
        { x: 0, y: 0 },
      );
      return { x: sum.x / pts.length, y: sum.y / pts.length };
    }
    default:
      return { x: 0, y: 0 };
  }
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function sigWeight(significance) {
  return SIGNIFICANCE_WEIGHT[significance] ?? SIGNIFICANCE_WEIGHT.major;
}

// ─── Детекция + классификация ─────────────────────────────────────────
// Жадное сопоставление: находки эксперта в порядке убывания значимости
// разбирают ближайшую свободную разметку учащегося на том же кадре в
// пределах matchRadius. Так критические находки «забирают» совпадения
// первыми, а не проигрывают их случайной incidental рядом.
function matchFindings(caseDoc, response, matchRadius) {
  const learner = (response.findings ?? []).map((f, i) => ({
    i,
    imageIndex: f.imageIndex,
    label: f.label,
    center: shapeCenter(f.shape, f.coords),
    used: false,
  }));

  const gt = [...(caseDoc.findings ?? [])].sort(
    (a, b) => sigWeight(b.significance) - sigWeight(a.significance),
  );

  const matches = [];
  for (const finding of gt) {
    const center = shapeCenter(finding.geometry.shape, finding.geometry.coords);
    let best = null;
    let bestDist = Infinity;
    for (const cand of learner) {
      if (cand.used || cand.imageIndex !== finding.imageIndex) continue;
      const d = distance(center, cand.center);
      if (d <= matchRadius && d < bestDist) {
        best = cand;
        bestDist = d;
      }
    }
    if (best) {
      best.used = true;
      matches.push({
        findingKey: finding.key,
        label: finding.label,
        significance: finding.significance,
        outcome: "hit",
        labelCorrect: best.label === finding.label,
      });
    } else {
      matches.push({
        findingKey: finding.key,
        label: finding.label,
        significance: finding.significance,
        outcome: "missed",
        labelCorrect: false,
      });
    }
  }

  // Разметка, не совпавшая ни с одной эталонной находкой, — ложная тревога.
  const falseAlarms = learner.filter((c) => !c.used).length;
  return { matches, falseAlarms };
}

// ─── Отдельные компоненты ─────────────────────────────────────────────
function detectionScore(caseDoc, matches, falseAlarms, rs) {
  const gt = caseDoc.findings ?? [];
  const possible = gt.reduce((s, f) => s + sigWeight(f.significance), 0);
  const penalty = rs.scoring.falseAlarmPenalty * falseAlarms;

  // Кейс-норма (эталонных находок нет): всё держится на отсутствии ложных
  // тревог — правильно «не увидеть несуществующее».
  if (possible === 0) {
    return falseAlarms === 0 ? 1 : Math.max(0, 1 - 0.34 * falseAlarms);
  }

  const gained = matches
    .filter((m) => m.outcome === "hit")
    .reduce((s, m) => s + sigWeight(m.significance), 0);
  return clamp01((gained - penalty) / possible);
}

function classificationScore(caseDoc, matches) {
  const gt = caseDoc.findings ?? [];
  if (gt.length === 0) {
    // Нечего называть: качество классификации не оценивается — вернём null,
    // чтобы компонент исключился из нормировки, а не занизил балл.
    return null;
  }
  const hits = matches.filter((m) => m.outcome === "hit");
  if (hits.length === 0) return 0;
  const correct = hits.filter((m) => m.labelCorrect).length;
  return correct / hits.length;
}

function checklistScore(response, rs) {
  const required = (rs.checklist ?? []).map((c) => c.key);
  if (required.length === 0) return null;
  const reviewed = new Set(response.reviewedChecklist ?? []);
  const done = required.filter((k) => reviewed.has(k)).length;
  return done / required.length;
}

function normKey(s) {
  return String(s ?? "").trim().toLowerCase();
}

function diagnosisScore(caseDoc, response) {
  const accepted = new Set(
    (caseDoc.impression?.diagnosisKeys ?? []).map(normKey).filter(Boolean),
  );
  if (accepted.size === 0) return null; // автор не задал ключ диагноза
  const given = (response.diagnosisKeys ?? []).map(normKey);
  return given.some((k) => accepted.has(k)) ? 1 : 0;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

// ─── Публичный вход ───────────────────────────────────────────────────
/**
 * Детерминированная часть оценки. ИИ-компонент (aiImpression) сюда не
 * входит — его считает attempt.service через impressionGrader и передаёт
 * в combineTotal отдельно.
 */
export function scoreDeterministic(caseDoc, response, rs) {
  const { matches, falseAlarms } = matchFindings(
    caseDoc,
    response,
    rs.scoring.matchRadius,
  );
  return {
    detection: detectionScore(caseDoc, matches, falseAlarms, rs),
    classification: classificationScore(caseDoc, matches),
    checklist: checklistScore(response, rs),
    diagnosis: diagnosisScore(caseDoc, response),
    matches,
    falseAlarms,
  };
}

/**
 * Взвешенный итог. Компоненты со score === null исключаются из суммы И из
 * знаменателя (перенормировка): выключенный ИИ-грейдинг или кейс без
 * диагноза не должны занижать балл, только не участвовать.
 */
export function combineTotal(components, weights, passThreshold) {
  let acc = 0;
  let wsum = 0;
  for (const [key, score] of Object.entries(components)) {
    if (score == null) continue;
    const w = weights[key] ?? 0;
    if (w <= 0) continue;
    acc += score * w;
    wsum += w;
  }
  const total = wsum > 0 ? acc / wsum : 0;
  return { total, passed: total >= passThreshold };
}
