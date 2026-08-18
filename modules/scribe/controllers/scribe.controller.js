// server/modules/scribe/controllers/scribe.controller.js
//
// HTTP-слой записи приёма. Вся логика в сервисах; здесь только разбор
// запроса и коды ответов.

import * as svc from "../services/scribe.service.js";
import { finishSession } from "../services/scribeDraft.service.js";
import ScribeSession from "../models/scribeSession.model.js";
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ServiceUnavailableError,
} from "../../../common/utils/errors.js";

function handle(res, err) {
  if (err instanceof ValidationError)
    return res.status(400).json({ success: false, message: err.message });
  if (err instanceof ForbiddenError)
    return res.status(403).json({ success: false, message: err.message });
  if (err instanceof NotFoundError)
    return res.status(404).json({ success: false, message: err.message });
  if (err instanceof ServiceUnavailableError)
    return res.status(503).json({ success: false, message: err.message });
  console.error("scribe:", err);
  return res.status(500).json({ success: false, message: "Server error" });
}

/**
 * Форма для интерфейса.
 *
 * Реплики НЕ отдаются, пока идёт приём: показывать расшифровку в
 * реальном времени незачем — она отвлекает от разговора, а ошибки
 * распознавания на полуслове выглядят тревожнее, чем есть.
 */
function shape(s) {
  return {
    id: String(s._id),
    status: s.status,
    room: s.room,
    participants: (s.participants || []).map((p) => ({
      role: p.role,
      consent: p.consent,
      seconds: p.seconds,
    })),
    startedAt: s.startedAt,
  };
}

export async function startController(req, res) {
  try {
    const session = await svc.startSession({
      doctorId: req.session.userId,
      room: req.body?.room,
      patientUserId: req.body?.patientUserId,
      appointmentId: req.body?.appointmentId || null,
      clinicId: req.body?.clinicId || null,
    });
    return res.status(201).json({ success: true, session: shape(session) });
  } catch (err) {
    return handle(res, err);
  }
}

export async function consentController(req, res) {
  try {
    const session = await svc.respondToConsent({
      sessionId: req.params.id,
      userId: req.session.userId,
      granted: req.body?.granted === true,
    });
    return res.json({ success: true, session: shape(session) });
  } catch (err) {
    return handle(res, err);
  }
}

export async function revokeController(req, res) {
  try {
    const session = await svc.revokeConsent({
      sessionId: req.params.id,
      userId: req.session.userId,
    });
    return res.json({ success: true, session: shape(session) });
  } catch (err) {
    return handle(res, err);
  }
}

export async function chunkController(req, res) {
  try {
    if (!req.file?.buffer?.length) {
      return res
        .status(400)
        .json({ success: false, message: "Кусок аудио не передан" });
    }
    const out = await svc.ingestChunk({
      sessionId: req.params.id,
      userId: req.session.userId,
      buffer: req.file.buffer,
      startSec: req.body?.startSec,
      lang: req.body?.lang || "",
    });
    return res.json({ success: true, ...out });
  } catch (err) {
    return handle(res, err);
  }
}

export async function finishController(req, res) {
  try {
    const out = await finishSession({
      sessionId: req.params.id,
      doctorId: req.session.userId,
      language: req.body?.language || "ru",
    });
    return res.json({ success: true, ...out });
  } catch (err) {
    return handle(res, err);
  }
}

/** Состояние сеанса — обе стороны опрашивают его во время приёма. */
export async function statusController(req, res) {
  try {
    const session = await ScribeSession.findById(req.params.id).lean();
    if (!session) throw new NotFoundError("Сеанс записи не найден");

    const me = (session.participants || []).find(
      (p) => String(p.userId) === String(req.session.userId),
    );
    if (!me) throw new ForbiddenError("Вы не участник этого приёма");

    return res.json({
      success: true,
      session: shape(session),
      myConsent: me.consent,
    });
  } catch (err) {
    return handle(res, err);
  }
}

export default {
  startController,
  consentController,
  revokeController,
  chunkController,
  finishController,
  statusController,
};
