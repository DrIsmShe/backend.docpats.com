// server/modules/radiology/duels/duel.service.js

import RadiologyDuel from "./models/radiologyDuel.model.js";
import RadiologyCase from "../radiology-cases/models/radiologyCase.model.js";
import RadiologyAttempt from "../radiology-attempts/models/radiologyAttempt.model.js";
import User from "../../../common/models/Auth/users.js";
import { addBonusXp } from "../game/game.service.js";
import { recordRadiologyEvent } from "../audit/audit.service.js";
import { NotFoundError, ConflictError, ValidationError } from "../../../common/utils/errors.js";

const WIN_BONUS = 40;
const DRAW_BONUS = 20;

async function userName(userId) {
  const u = await User.findById(userId).select("firstName").lean();
  return u?.firstName || "Врач";
}

function serialize(duel, meId) {
  const me = String(meId);
  const side = (s) => ({
    name: s.name,
    score: s.score,
    isMe: s.userId ? String(s.userId) === me : false,
    played: s.score != null,
  });
  return {
    _id: duel._id,
    caseId: duel.caseId,
    caseTitle: duel.caseTitle,
    modality: duel.modality,
    status: duel.status,
    winner: duel.winner,
    challenger: side(duel.challenger),
    opponent: side(duel.opponent),
    createdAt: duel.createdAt,
  };
}

// Создать вызов на опубликованном кейсе. Создатель проходит его следующим
// шагом (?duel=id в ридере), результат придёт через submitResult.
export async function createDuel(caseId, userId) {
  const caseDoc = await RadiologyCase.findById(caseId)
    .select("title modality status")
    .lean();
  if (!caseDoc || caseDoc.status !== "published") throw new NotFoundError("Radiology case");

  const duel = await RadiologyDuel.create({
    caseId,
    caseTitle: caseDoc.title,
    modality: caseDoc.modality,
    challenger: { userId, name: await userName(userId) },
    status: "awaiting_challenger",
  });
  recordRadiologyEvent({ action: "duel.create", actorId: userId, caseId, metadata: {} });
  return serialize(duel, userId);
}

// Засчитать попытку в дуэль (за создателя или за соперника). Определяем
// сторону по тому, кто вызывает; когда оба прошли — считаем победителя.
export async function submitResult(duelId, userId, attemptId) {
  const duel = await RadiologyDuel.findById(duelId);
  if (!duel) throw new NotFoundError("Duel");

  const attempt = await RadiologyAttempt.findById(attemptId)
    .select("userId caseId status score")
    .lean();
  if (!attempt) throw new NotFoundError("Radiology attempt");
  if (String(attempt.userId) !== String(userId)) throw new ValidationError("Это чужая попытка");
  if (attempt.status !== "submitted") throw new ConflictError("Попытка ещё не сдана");
  if (String(attempt.caseId) !== String(duel.caseId)) {
    throw new ValidationError("Попытка не по кейсу этой дуэли");
  }
  const score = attempt.score?.total ?? 0;
  const isChallenger = String(duel.challenger.userId) === String(userId);

  if (isChallenger) {
    if (duel.challenger.score != null) throw new ConflictError("Ваш результат уже засчитан");
    duel.challenger.score = score;
    duel.challenger.attemptId = attemptId;
    if (duel.status === "awaiting_challenger") duel.status = "open";
  } else {
    if (duel.status === "awaiting_challenger") {
      throw new ConflictError("Создатель ещё не прошёл кейс — дуэль пока недоступна");
    }
    if (duel.opponent.userId && String(duel.opponent.userId) !== String(userId)) {
      throw new ConflictError("Эту дуэль уже принял другой игрок");
    }
    if (duel.opponent.score != null) throw new ConflictError("Ваш результат уже засчитан");
    duel.opponent.userId = userId;
    duel.opponent.name = await userName(userId);
    duel.opponent.score = score;
    duel.opponent.attemptId = attemptId;
  }

  // Оба прошли — определяем победителя и начисляем бонус.
  if (duel.challenger.score != null && duel.opponent.score != null) {
    const cs = duel.challenger.score;
    const os = duel.opponent.score;
    duel.winner = cs > os ? "challenger" : os > cs ? "opponent" : "draw";
    duel.status = "completed";

    if (duel.winner === "draw") {
      await addBonusXp(duel.challenger.userId, DRAW_BONUS);
      await addBonusXp(duel.opponent.userId, DRAW_BONUS);
    } else {
      const winId = duel.winner === "challenger" ? duel.challenger.userId : duel.opponent.userId;
      await addBonusXp(winId, WIN_BONUS);
    }
    recordRadiologyEvent({
      action: "duel.completed",
      actorId: userId,
      caseId: duel.caseId,
      metadata: { winner: duel.winner },
    });
  }

  await duel.save();
  return serialize(duel, userId);
}

export async function listDuels(userId, filter = "open") {
  if (filter === "mine") {
    const duels = await RadiologyDuel.find({
      $or: [{ "challenger.userId": userId }, { "opponent.userId": userId }],
    })
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();
    return duels.map((d) => serialize(d, userId));
  }

  // open: чужой вызов, создатель уже прошёл, соперника ещё нет.
  const duels = await RadiologyDuel.find({
    status: "open",
    "challenger.userId": { $ne: userId },
    "opponent.userId": null,
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  return duels.map((d) => serialize(d, userId));
}
