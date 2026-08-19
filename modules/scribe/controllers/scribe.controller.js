// server/modules/scribe/controllers/scribe.controller.js
//
// HTTP-слой записи приёма. Вся логика в сервисах; здесь только разбор
// запроса и коды ответов.

import * as svc from "../services/scribe.service.js";
import { finishSession } from "../services/scribeDraft.service.js";
import { translateDraft, TRANSLATABLE } from "../ai/draftTranslator.js";
import {
  saveScribeDraftPrivate,
  findPrivatePatientByUser,
} from "../services/scribeSavePrivate.service.js";
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
      // Телемед-приём знает карту пациента заранее — берём её оттуда,
      // а не ищем потом по аккаунту.
      telemedSessionId: req.body?.telemedSessionId || null,
      // Язык приёма, выбранный врачом перед записью.
      lang: req.body?.lang || "",
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
    // Язык не передаём: черновик пишется на языке разговора. Перевести
    // его врач может отдельным действием, зная, что это перевод.
    const out = await finishSession({
      sessionId: req.params.id,
      doctorId: req.session.userId,
    });
    return res.json({ success: true, ...out });
  } catch (err) {
    return handle(res, err);
  }
}

/**
 * POST /sessions/:id/translate — перевести черновик.
 *
 * Переводим ТО, ЧТО СЕЙЧАС В ПОЛЯХ, а не собранное моделью: врач мог всё
 * переписать, и переводить его правки, а не наш исходный вывод, —
 * единственное осмысленное поведение.
 *
 * Результат НЕ сохраняется: это предложение врачу. В карту попадёт то,
 * что останется в полях, когда он нажмёт «Сохранить».
 */
export async function translateController(req, res) {
  try {
    const session = await ScribeSession.findById(req.params.id).lean();
    if (!session) throw new NotFoundError("Сеанс записи не найден");
    if (String(session.doctorId) !== String(req.session.userId)) {
      throw new ForbiddenError("Черновик приёма доступен только его врачу");
    }

    const to = String(req.body?.to || "").trim();
    if (!TRANSLATABLE[to]) {
      throw new ValidationError("Перевод на этот язык не поддерживается");
    }

    const out = await translateDraft({ fields: req.body?.fields || {}, to });
    return res.json({ success: true, ...out, to });
  } catch (err) {
    return handle(res, err);
  }
}

/**
 * GET /private-patient/by-user/:userId — карта ЧАСТНОГО врача.
 *
 * Для врача без клиники: клинический поиск ему недоступен (нет
 * арендатора), а карта у него своя. Ищем только среди ЕГО пациентов —
 * одноимённая карта у другого врача это чужая запись.
 */
export async function privatePatientByUserController(req, res) {
  try {
    const patient = await findPrivatePatientByUser({
      doctorId: req.session.userId,
      userId: req.params.userId,
    });
    // null, а не 404: у врача может не быть карты на этого человека, и
    // это обычное дело, а не ошибка.
    return res.json({ success: true, patient });
  } catch (err) {
    return handle(res, err);
  }
}

/**
 * POST /sessions/:id/save-private — сохранить черновик частному врачу.
 *
 * Отдельно от клинического пути: там запись принадлежит организации и
 * живёт за проверкой прав арендатора, здесь — врачу, и клиники в ней
 * нет вовсе.
 */
export async function savePrivateController(req, res) {
  try {
    const doc = await saveScribeDraftPrivate({
      sessionId: req.params.id,
      doctorId: req.session.userId,
      patientRef: req.body?.patientRef,
      patientTypeModel: req.body?.patientTypeModel,
      body: req.body?.fields || {},
    });
    return res.status(201).json({ success: true, encounterId: String(doc._id) });
  } catch (err) {
    return handle(res, err);
  }
}

/**
 * GET /sessions/by-room/:room — найти сеанс приёма по комнате.
 *
 * БЕЗ ЭТОГО МОДУЛЬ НЕ РАБОТАЕТ ВОВСЕ. Сеанс создаёт врач, и его
 * идентификатор существует только у него. Пациент знает лишь комнату, в
 * которой идёт звонок, — и без поиска по ней он не узнал бы, что у него
 * спрашивают согласие, а врач ждал бы ответа, которого не будет.
 *
 * Отдаём только участникам сеанса: комната известна обеим сторонам, но
 * посторонний, угадавший её имя, участником не станет.
 */
export async function byRoomController(req, res) {
  try {
    const session = await ScribeSession.findOne({
      room: req.params.room,
      status: { $in: ["awaiting_consent", "recording", "revoked"] },
    })
      .sort({ createdAt: -1 })
      .lean();

    if (!session) return res.json({ success: true, session: null });

    const me = (session.participants || []).find(
      (p) => String(p.userId) === String(req.session.userId),
    );
    // Не участник — отвечаем «нет сеанса», а не «доступ запрещён»:
    // существование чужого приёма посторонним знать незачем.
    if (!me) return res.json({ success: true, session: null });

    return res.json({
      success: true,
      session: shape(session),
      myConsent: me.consent,
    });
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
  byRoomController,
  translateController,
  privatePatientByUserController,
  savePrivateController,
  consentController,
  revokeController,
  chunkController,
  finishController,
  statusController,
};
