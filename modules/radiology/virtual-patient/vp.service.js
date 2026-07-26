// server/modules/radiology/virtual-patient/vp.service.js
//
// Режим «Виртуальный пациент»: жалоба → заказ обследований → диагноз.
// Переиспользует движки арены (combineTotal, gradeImpression, awardForAttempt).
//
// Результаты обследований НЕ уходят учащемуся заранее: он «назначает»
// обследование отдельным запросом (orderInvestigation), и только тогда
// сервер раскрывает результат И фиксирует назначение. Так оценка разумного
// набора (не заказал лишнего) остаётся авторитетной, а не декоративной.

import VirtualPatientCase from "./models/vpCase.model.js";
import VirtualPatientAttempt from "./models/vpAttempt.model.js";
import { combineTotal } from "../radiology-attempts/services/scoring.service.js";
import { gradeImpression } from "../radiology-attempts/services/impressionGrader.js";
import { awardForAttempt } from "../game/game.service.js";
import { gradeDiagnosis } from "../radiology-attempts/services/diagnosisMatcher.js";
import { recordRadiologyEvent } from "../audit/audit.service.js";
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from "../../../common/utils/errors.js";

// Диагноз здесь — главное; разумный набор обследований и обоснование — рядом.
const WEIGHTS = { diagnosis: 0.55, workup: 0.3, reasoning: 0.15 };
const PASS = 0.7;

// ─── Скоринг ──────────────────────────────────────────────────────────
function scoreVp(caseDoc, response) {
  const invKeys = new Set(caseDoc.investigations.map((i) => i.key));
  const necessary = new Set(
    caseDoc.investigations.filter((i) => i.necessary).map((i) => i.key),
  );
  const ordered = new Set((response.ordered ?? []).filter((k) => invKeys.has(k)));

  let workup;
  const overKeys = [...ordered].filter((k) => !necessary.has(k));
  if (necessary.size === 0) {
    workup = null;
  } else {
    const covered = [...necessary].filter((k) => ordered.has(k)).length / necessary.size;
    // Каждое лишнее обследование — минус 10% (гипердиагностика штрафуется).
    workup = Math.max(0, Math.min(1, covered - 0.1 * overKeys.length));
  }

  // Диагноз: точное совпадение ключа ИЛИ вхождение ключа/синонима в
  // развёрнутую формулировку — см. diagnosisMatcher.
  const { score: diagnosis } = gradeDiagnosis({
    givenKeys: response.diagnosisKeys,
    givenText: response.diagnosisText,
    acceptedKeys: caseDoc.diagnosis?.diagnosisKeys,
    synonyms: caseDoc.diagnosis?.diagnosisSynonyms,
  });

  const nameByKey = new Map(caseDoc.investigations.map((i) => [i.key, i.name]));
  return {
    workup,
    diagnosis,
    overordered: overKeys.length,
    workupDetail: {
      missedNecessary: [...necessary]
        .filter((k) => !ordered.has(k))
        .map((k) => nameByKey.get(k) ?? k),
      overordered: overKeys.map((k) => nameByKey.get(k) ?? k),
      orderedCount: ordered.size,
    },
  };
}

export function collectVpBlockers(doc) {
  const b = [];
  if ((doc.investigations?.length ?? 0) < 2) b.push("добавьте минимум 2 обследования");
  if (!doc.investigations?.some((i) => i.necessary))
    b.push("отметьте хотя бы одно нужное обследование");
  if (!(doc.diagnosis?.diagnosisKeys?.length ?? 0)) b.push("укажите верный диагноз");
  if (["public_government", "licensed"].includes(doc.source?.kind) && !doc.source?.authority)
    b.push("для заимствованного материала не указан орган/издание");
  return b;
}

// ─── CRUD ─────────────────────────────────────────────────────────────
export async function createVpCase(input, actorId, actorRole) {
  const doc = await VirtualPatientCase.create({
    title: input.title,
    presentation: input.presentation ?? "",
    difficulty: input.difficulty ?? "medium",
    categoryId: input.categoryId ?? null,
    investigations: input.investigations ?? [],
    diagnosis: input.diagnosis ?? {},
    source: input.source,
    status: "draft",
    createdBy: actorId,
  });
  recordRadiologyEvent({ action: "vp.create", actorId, actorRole, metadata: { inv: doc.investigations.length } });
  return doc.toObject();
}

export async function updateVpCase(caseId, patch) {
  const doc = await VirtualPatientCase.findById(caseId);
  if (!doc) throw new NotFoundError("VP case");
  if (doc.status === "archived") throw new ConflictError("Архивный кейс редактировать нельзя");
  const FIELDS = ["title", "presentation", "difficulty", "categoryId", "investigations", "diagnosis", "source"];
  for (const f of FIELDS) if (patch[f] !== undefined) doc[f] = patch[f];
  await doc.save();
  return doc.toObject();
}

export async function setVpStatus(caseId, status, actorId, actorRole) {
  const doc = await VirtualPatientCase.findById(caseId);
  if (!doc) throw new NotFoundError("VP case");
  if (status === "published") {
    const blockers = collectVpBlockers(doc);
    if (blockers.length) {
      throw new ValidationError(`Опубликовать нельзя: ${blockers.join("; ")}`, { blockers });
    }
    doc.status = "published";
    doc.publishedAt = doc.publishedAt ?? new Date();
  } else if (status === "draft" || status === "archived") {
    doc.status = status;
  } else {
    throw new ValidationError("Неизвестный статус");
  }
  await doc.save();
  recordRadiologyEvent({ action: `vp.${status}`, actorId, actorRole, metadata: {} });
  return doc.toObject();
}

export async function listVpCases({ isEditor, scope, status }) {
  const query = {};
  if (isEditor && scope === "all") {
    if (status) query.status = status;
  } else {
    query.status = "published";
  }
  return VirtualPatientCase.find(query)
    .sort({ createdAt: -1 })
    .limit(200)
    .select("_id title difficulty status createdAt")
    .lean();
}

export async function getVpCaseFull(caseId) {
  const doc = await VirtualPatientCase.findById(caseId).lean();
  if (!doc) throw new NotFoundError("VP case");
  return { ...doc, publishBlockers: collectVpBlockers(doc) };
}

// Учащемуся: жалоба + МЕНЮ обследований без результатов и без пометки
// «нужное» — результат раскрывается только при заказе.
export function sanitizeVpForLearner(doc) {
  return {
    _id: doc._id,
    title: doc.title,
    presentation: doc.presentation,
    difficulty: doc.difficulty,
    investigations: (doc.investigations ?? []).map((i) => ({
      key: i.key,
      name: i.name,
      category: i.category,
    })),
  };
}

// ─── Прохождение ──────────────────────────────────────────────────────
export async function startVpAttempt(caseId, userId) {
  const caseDoc = await VirtualPatientCase.findById(caseId).lean();
  if (!caseDoc || caseDoc.status !== "published") throw new NotFoundError("VP case");
  const attempt = await VirtualPatientAttempt.create({ caseId, userId, status: "in_progress" });
  recordRadiologyEvent({ action: "vp.attempt_start", actorId: userId, attemptId: attempt._id });
  return { attempt: attempt.toObject(), case: sanitizeVpForLearner(caseDoc) };
}

// Назначить обследование: раскрываем результат И фиксируем заказ.
export async function orderInvestigation(attemptId, userId, key) {
  const attempt = await VirtualPatientAttempt.findById(attemptId);
  if (!attempt) throw new NotFoundError("VP attempt");
  if (String(attempt.userId) !== String(userId)) throw new ForbiddenError("Это чужая попытка");
  if (attempt.status === "submitted") throw new ConflictError("Попытка уже сдана");

  const caseDoc = await VirtualPatientCase.findById(attempt.caseId).lean();
  if (!caseDoc) throw new NotFoundError("VP case");
  const inv = caseDoc.investigations.find((i) => i.key === key);
  if (!inv) throw new NotFoundError("Investigation");

  if (!attempt.response.ordered.includes(key)) {
    attempt.response.ordered.push(key);
    await attempt.save();
  }
  return {
    key: inv.key,
    name: inv.name,
    category: inv.category,
    resultText: inv.resultText,
    imageUrl: inv.imageUrl,
  };
}

function buildVpReview(caseDoc, attempt) {
  const orderedSet = new Set(attempt.response.ordered ?? []);
  return {
    diagnosis: {
      correctText: caseDoc.diagnosis?.correctText ?? "",
      diagnosisKeys: caseDoc.diagnosis?.diagnosisKeys ?? [],
    },
    workupDetail: attempt.workupDetail,
    // Полный список обследований с пометкой «нужное» и «назначал ли» —
    // чтобы учащийся увидел, что стоило заказать.
    investigations: (caseDoc.investigations ?? []).map((i) => ({
      name: i.name,
      category: i.category,
      necessary: i.necessary,
      ordered: orderedSet.has(i.key),
    })),
  };
}

export async function submitVpAttempt(attemptId, userId, response) {
  const attempt = await VirtualPatientAttempt.findById(attemptId);
  if (!attempt) throw new NotFoundError("VP attempt");
  if (String(attempt.userId) !== String(userId)) throw new ForbiddenError("Это чужая попытка");
  if (attempt.status === "submitted") throw new ConflictError("Попытка уже сдана");

  const caseDoc = await VirtualPatientCase.findById(attempt.caseId).lean();
  if (!caseDoc) throw new NotFoundError("VP case");

  // ordered берём из уже зафиксированных заказов (не из тела запроса).
  const resp = {
    ordered: attempt.response.ordered ?? [],
    diagnosisKeys: response.diagnosisKeys ?? [],
    diagnosisText: response.diagnosisText ?? "",
    reasoningText: response.reasoningText ?? "",
  };

  const det = scoreVp(caseDoc, resp);
  const aiFeedback = await gradeImpression({
    impressionText: resp.reasoningText,
    correctText: caseDoc.diagnosis?.correctText ?? "",
    diagnosisSynonyms: caseDoc.diagnosis?.diagnosisSynonyms ?? [],
  });

  const { total, passed } = combineTotal(
    { diagnosis: det.diagnosis, workup: det.workup, reasoning: aiFeedback?.score ?? null },
    WEIGHTS,
    PASS,
  );

  attempt.response = resp;
  attempt.workupDetail = det.workupDetail;
  attempt.aiFeedback = aiFeedback;
  attempt.score = {
    total,
    passed,
    diagnosis: det.diagnosis,
    workup: det.workup,
    reasoning: aiFeedback?.score ?? null,
  };
  attempt.status = "submitted";
  attempt.submittedAt = new Date();
  await attempt.save();

  const c = await VirtualPatientCase.findById(attempt.caseId).select("stats");
  if (c) {
    const n = c.stats.attempts ?? 0;
    c.stats.attempts = n + 1;
    c.stats.avgScore = ((c.stats.avgScore ?? 0) * n + total) / (n + 1);
    await c.save();
  }

  let game = null;
  try {
    game = await awardForAttempt({
      userId,
      score: total,
      passed,
      falseAlarms: det.overordered,
      caughtCritical: false,
    });
  } catch {
    /* игровой слой не критичен */
  }

  recordRadiologyEvent({
    action: "vp.attempt_submit",
    actorId: userId,
    attemptId: attempt._id,
    metadata: { total: Math.round(total * 100) / 100, passed, ordered: resp.ordered.length },
  });

  return { attempt: attempt.toObject(), review: buildVpReview(caseDoc, attempt), game };
}

export async function getVpAttempt(attemptId, userId) {
  const attempt = await VirtualPatientAttempt.findById(attemptId).lean();
  if (!attempt) throw new NotFoundError("VP attempt");
  if (String(attempt.userId) !== String(userId)) throw new ForbiddenError("Это чужая попытка");
  if (attempt.status === "submitted") {
    const caseDoc = await VirtualPatientCase.findById(attempt.caseId).lean();
    return { attempt, review: caseDoc ? buildVpReview(caseDoc, attempt) : null };
  }
  return { attempt, review: null };
}
