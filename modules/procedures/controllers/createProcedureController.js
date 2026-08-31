// server/modules/procedures/controllers/createProcedureController.js
//
// Врач записывает пациента на ОПЕРАЦИЮ или ОБСЛЕДОВАНИЕ.
//
// POST /procedures
// {
//   kind: "surgery" | "examination",
//   title, code?,
//   startsAt | startsAtLocal, durationMin,
//   place?, preparation?, fasting?, anesthesia?,
//   notesDoctor?,
//   patient: { kind: "registered"|"private"|"new", id?, firstName?, lastName?, phone? }
// }
//
// Отличия от записи на приём, которые здесь существенны:
//   * времени НЕ ищут в сетке слотов. Операция длится часы и в двадцатиминутную
//     сетку не ложится; врач называет начало и длительность сам.
//   * зато занятость проверяется по ДВУМ коллекциям сразу (см. assertFree):
//     нельзя оперировать и вести приём одновременно.
//
// doctorId берётся из профиля по сессии и ниоткуда больше.

import ProcedureBooking from "../../../common/models/Procedure/procedureBooking.js";
import { decrypt } from "../../../common/models/Auth/users.js";
import {
  resolveBookingPatient,
  BookingPatientError,
} from "../../../common/services/bookingPatient.service.js";
import { notify } from "../../notifications/services/notification.service.js";
import { recordActionAsync } from "../../audit/services/audit.service.js";
import {
  ProcedureError,
  resolveDoctorContext,
  resolveStart,
  resolveEnd,
  assertNotInPast,
  assertFree,
} from "../services/procedure.service.js";
import { validateCreate } from "../validators/procedure.validator.js";
import { toProcedureDTO } from "../procedure.mapper.js";
import { tReq } from "../../../common/i18n/index.js";
import { errorText } from "../../../common/i18n/index.js";

function fail(res, err) {
  if (err instanceof ProcedureError || err instanceof BookingPatientError) {
    return res.status(err.status || 400).json({
      success: false,
      message: errorText(err, res.req),
      ...(err.code ? { code: err.code } : {}),
      ...(err.extra || {}),
    });
  }
  throw err;
}

export const createProcedureController = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: tReq(req, "app.auth.required") });
    }

    let payload;
    try {
      payload = validateCreate(req.body || {});
    } catch (err) {
      return fail(res, err);
    }

    let ctx;
    let starts;
    let ends;
    let patientRef;
    try {
      ctx = await resolveDoctorContext(userId);
      starts = resolveStart({
        startsAt: payload.startsAt,
        startsAtLocal: payload.startsAtLocal,
        zone: ctx.zone,
      });
      assertNotInPast(starts);
      ends = resolveEnd({ starts, durationMin: payload.durationMin });
      await assertFree({ doctorId: ctx.doctorId, starts, ends });
      patientRef = await resolveBookingPatient({
        patient: payload.patient,
        doctorProfileId: ctx.doctorId,
        doctorUserId: userId,
      });
    } catch (err) {
      return fail(res, err);
    }

    let booking;
    try {
      booking = await ProcedureBooking.create({
        doctorId: ctx.doctorId,
        doctorIdUser: userId,
        patientId: patientRef.patientId,
        privatePatientId: patientRef.privatePatientId,
        kind: payload.kind,
        title: payload.title,
        code: payload.code,
        startsAt: starts,
        endsAt: ends,
        place: payload.place,
        preparation: payload.preparation,
        fasting: payload.fasting,
        anesthesia: payload.anesthesia,
        notesDoctor: payload.notesDoctor,
        status: "planned",
        createdBy: userId,
      });
    } catch (err) {
      // Гонка двойного клика: уникальный partial-индекс по (doctorId, startsAt)
      // среди активных. Проверка выше её не ловит — она check-then-act.
      if (err?.code === 11000) {
        return res.status(409).json({
          success: false,
          message: tReq(req, "app.appointment.timeSlotAlreadyBooked"),
          code: "SLOT_TAKEN_PROCEDURE",
        });
      }
      throw err;
    }

    // HIPAA-журнал. metadata без PHI: ни имени пациента, ни названия
    // вмешательства — диагноз выводится из названия операции напрямую.
    recordActionAsync({
      actor: { userId: String(userId), role: "doctor" },
      action: "procedure.create",
      resourceType: "procedure",
      resourceId: String(booking._id),
      resourceOwnerId: patientRef.notifyUserId
        ? String(patientRef.notifyUserId)
        : undefined,
      metadata: {
        kind: payload.kind,
        patientKind: payload.patient.kind,
        durationMin: payload.durationMin,
        hasPreparation: Boolean(payload.preparation),
        anesthesia: payload.anesthesia,
      },
      context: {
        ipAddress: req.ip,
        userAgent: req.headers?.["user-agent"],
        httpMethod: req.method,
        httpPath: req.originalUrl,
      },
    });

    // Уведомление — только пациенту с аккаунтом; приватной карточке слать
    // некуда, её телефон врач видит сам.
    if (patientRef.notifyUserId) {
      const doctorName = [
        decrypt(req.user?.firstNameEncrypted),
        decrypt(req.user?.lastNameEncrypted),
      ]
        .filter(Boolean)
        .join(" ");

      const when = new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: ctx.zone,
      }).format(starts);

      const what =
        payload.kind === "surgery" ? "операцию" : "обследование";

      await notify({
        userId: patientRef.notifyUserId,
        senderId: userId,
        type: "procedure_booked_by_doctor",
        title: `Вас записали на ${what}`,
        message:
          `Доктор ${doctorName || ""} назначил ${what}: ${payload.title} — ${when}.`.replace(
            /\s+/g,
            " ",
          ),
        i18n: {
          title: "app.notify.procedureBooked.title",
          message: "app.notify.procedureBooked.message",
          params: {
            doctorName: doctorName || "",
            // Вид вмешательства — сам код словаря: внутри турецкой фразы
            // не должно оказаться русского слова «операцию».
            what:
              payload.kind === "surgery"
                ? "app.procedure.kind.surgery"
                : "app.procedure.kind.examination",
            title: payload.title,
            when: starts.toISOString(),
          },
        },
        link: "/patient/my-procedures",
        icon: "activity",
        meta: {
          procedureId: String(booking._id),
          kind: payload.kind,
          // Подготовку кладём в мету, чтобы кабинет пациента показал её
          // рядом с записью, не запрашивая её отдельно.
          preparation: payload.preparation || null,
          fasting: Boolean(payload.fasting),
        },
      }).catch((e) => console.error("notify failed:", e?.message));
    }

    return res.status(201).json({
      success: true,
      procedure: toProcedureDTO(booking, {
        patientName: patientRef.patientName,
      }),
      notified: Boolean(patientRef.notifyUserId),
    });
  } catch (err) {
    console.error("❌ Ошибка createProcedure:", err);
    return res
      .status(500)
      .json({ success: false, message: tReq(req, "app.server.error"), error: errorText(err, req) });
  }
};

export default createProcedureController;
