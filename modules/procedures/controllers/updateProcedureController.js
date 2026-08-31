// server/modules/procedures/controllers/updateProcedureController.js
//
// Смена статуса, перенос и архивирование вмешательства.
//
//   PATCH /procedures/:id/status     { status, cancelReason? }
//   POST  /procedures/:id/postpone   { startsAt|startsAtLocal, durationMin?, reason? }
//   PATCH /procedures/:id/archive    { archived: true|false }
//
// Перенос — не смена времени в той же записи. Он создаёт НОВУЮ запись и
// помечает старую как postponed со ссылкой на неё. Иначе теряется история:
// «сколько раз переносили эту операцию» — первый вопрос при разборе жалобы,
// а перезапись поля startsAt отвечает на него «ни разу».

import ProcedureBooking from "../../../common/models/Procedure/procedureBooking.js";
import { recordActionAsync } from "../../audit/services/audit.service.js";
import { notify } from "../../notifications/services/notification.service.js";
import {
  ProcedureError,
  resolveDoctorContext,
  resolveStart,
  resolveEnd,
  assertNotInPast,
  assertFree,
  assertTransition,
  stampForStatus,
} from "../services/procedure.service.js";
import {
  validateStatus,
  validatePostpone,
} from "../validators/procedure.validator.js";
import {
  resolvePatientNames,
  nameOf,
} from "../services/procedureNames.service.js";
import { toProcedureDTO } from "../procedure.mapper.js";
import { tReq } from "../../../common/i18n/index.js";
import { errorText } from "../../../common/i18n/index.js";

function fail(res, err) {
  if (err instanceof ProcedureError) {
    return res.status(err.status || 400).json({
      success: false,
      // Помощник видит только ответ — запрос достаём из него, ради языка.
      message: err.i18n ? (res.req?.t?.(err.i18n) ?? err.message) : err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.extra || {}),
    });
  }
  throw err;
}

/** Запись врача по id. Фильтр по doctorId — не украшение: без него врач
 *  правил бы чужие вмешательства, зная только идентификатор. */
async function loadOwn(id, doctorId) {
  const doc = await ProcedureBooking.findOne({ _id: id, doctorId });
  if (!doc) {
    throw Object.assign(new ProcedureError("Запись не найдена", { status: 404 }), {
      i18n: "app.appointment.notFound3",
    });
  }
  return doc;
}

async function dtoOf(doc) {
  const names = await resolvePatientNames([doc]);
  return toProcedureDTO(doc, { patientName: nameOf(doc, names) });
}

export const updateProcedureStatusController = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: tReq(req, "app.auth.required") });
    }

    let doc;
    let payload;
    try {
      payload = validateStatus(req.body || {});
      const ctx = await resolveDoctorContext(userId);
      doc = await loadOwn(req.params.id, ctx.doctorId);
      assertTransition(doc.status, payload.status);
    } catch (err) {
      return fail(res, err);
    }

    doc.status = payload.status;
    Object.assign(
      doc,
      stampForStatus(payload.status, { cancelReason: payload.cancelReason }),
    );
    await doc.save();

    recordActionAsync({
      actor: { userId: String(userId), role: "doctor" },
      action: "procedure.status",
      resourceType: "procedure",
      resourceId: String(doc._id),
      metadata: { to: payload.status, kind: doc.kind },
      context: {
        ipAddress: req.ip,
        userAgent: req.headers?.["user-agent"],
        httpMethod: req.method,
        httpPath: req.originalUrl,
      },
    });

    return res.json({ success: true, procedure: await dtoOf(doc) });
  } catch (err) {
    console.error("❌ Ошибка updateProcedureStatus:", err);
    return res
      .status(500)
      .json({ success: false, message: tReq(req, "app.server.error"), error: errorText(err, req) });
  }
};

export const postponeProcedureController = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: tReq(req, "app.auth.required") });
    }

    let ctx;
    let doc;
    let payload;
    let starts;
    let ends;
    try {
      payload = validatePostpone(req.body || {});
      ctx = await resolveDoctorContext(userId);
      doc = await loadOwn(req.params.id, ctx.doctorId);
      assertTransition(doc.status, "postponed");

      starts = resolveStart({
        startsAt: payload.startsAt,
        startsAtLocal: payload.startsAtLocal,
        zone: ctx.zone,
      });
      assertNotInPast(starts);
      ends = resolveEnd({
        starts,
        durationMin:
          payload.durationMin ??
          Math.round((doc.endsAt - doc.startsAt) / 60000),
      });
      // Саму себя конфликтом не считаем: старое время освободится этим же
      // запросом, и запретить перенос «на час позже» было бы абсурдом.
      await assertFree({
        doctorId: ctx.doctorId,
        starts,
        ends,
        excludeId: doc._id,
      });
    } catch (err) {
      return fail(res, err);
    }

    // Порядок важен: сначала снимаем старую запись с активных статусов,
    // потом вставляем новую. Обратный порядок ловится уникальным индексом
    // только при совпадении начала — а при переносе на 15 минут вперёд
    // старая и новая пересеклись бы и без него.
    // Запоминаем до мутации: откат ниже должен вернуть ИСХОДНЫЙ статус.
    // Жёсткое "confirmed" повышало бы запланированную запись до
    // подтверждённой на ошибке переноса — тихо и не в ту сторону.
    const previousStatus = doc.status;

    doc.status = "postponed";
    Object.assign(doc, stampForStatus("postponed"));
    if (payload.reason) doc.cancelReason = payload.reason;
    await doc.save();

    let created;
    try {
      created = await ProcedureBooking.create({
        doctorId: doc.doctorId,
        doctorIdUser: doc.doctorIdUser,
        patientId: doc.patientId,
        privatePatientId: doc.privatePatientId,
        kind: doc.kind,
        title: doc.title,
        code: doc.code,
        startsAt: starts,
        endsAt: ends,
        place: doc.place,
        preparation: doc.preparation,
        fasting: doc.fasting,
        anesthesia: doc.anesthesia,
        notesDoctor: doc.notesDoctor,
        status: "planned",
        createdBy: userId,
      });
    } catch (err) {
      // Новая запись не создалась — возвращаем старую в строй, иначе врач
      // остаётся вообще без записи, а пациент — без времени.
      doc.status = previousStatus;
      doc.postponedAt = null;
      await doc.save().catch(() => {});
      if (err?.code === 11000) {
        return res.status(409).json({
          success: false,
          message: tReq(req, "app.appointment.timeSlotAlreadyBooked"),
          code: "SLOT_TAKEN_PROCEDURE",
        });
      }
      throw err;
    }

    doc.postponedToId = created._id;
    await doc.save();

    recordActionAsync({
      actor: { userId: String(userId), role: "doctor" },
      action: "procedure.postpone",
      resourceType: "procedure",
      resourceId: String(doc._id),
      metadata: { kind: doc.kind, newId: String(created._id) },
      context: {
        ipAddress: req.ip,
        userAgent: req.headers?.["user-agent"],
        httpMethod: req.method,
        httpPath: req.originalUrl,
      },
    });

    // Пациенту с аккаунтом перенос сообщается: это изменение его планов,
    // а не внутренняя перестановка в календаре врача.
    if (doc.patientId) {
      const when = new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: ctx.zone,
      }).format(starts);
      await notify({
        userId: doc.patientId,
        senderId: userId,
        type: "procedure_postponed",
        title: "Запись перенесена",
        message: `«${doc.title}» перенесена на ${when}.`,
        i18n: {
          title: "app.notify.procedureMoved.title",
          message: "app.notify.procedureMoved.message",
          params: { title: doc.title, when: starts.toISOString() },
        },
        link: "/patient/my-procedures",
        icon: "activity",
        meta: { procedureId: String(created._id), kind: doc.kind },
      }).catch((e) => console.error("notify failed:", e?.message));
    }

    return res.status(201).json({
      success: true,
      procedure: await dtoOf(created),
      previousId: String(doc._id),
    });
  } catch (err) {
    console.error("❌ Ошибка postponeProcedure:", err);
    return res
      .status(500)
      .json({ success: false, message: tReq(req, "app.server.error"), error: errorText(err, req) });
  }
};

export const archiveProcedureController = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: tReq(req, "app.auth.required") });
    }

    let doc;
    try {
      const ctx = await resolveDoctorContext(userId);
      doc = await loadOwn(req.params.id, ctx.doctorId);
    } catch (err) {
      return fail(res, err);
    }

    const archived = req.body?.archived !== false;
    // Живую запись в архив не убираем: «с глаз долой» здесь означало бы
    // забытую операцию, на которую пациент всё равно придёт.
    if (archived && ["planned", "confirmed"].includes(doc.status)) {
      return res.status(409).json({
        success: false,
        message:
          tReq(req, "app.appointment.cannotArchiveActive"),
        code: "STILL_ACTIVE",
      });
    }

    doc.isArchived = archived;
    doc.archivedAt = archived ? new Date() : null;
    await doc.save();

    return res.json({ success: true, procedure: await dtoOf(doc) });
  } catch (err) {
    console.error("❌ Ошибка archiveProcedure:", err);
    return res
      .status(500)
      .json({ success: false, message: tReq(req, "app.server.error"), error: errorText(err, req) });
  }
};
