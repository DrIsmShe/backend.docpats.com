// server/modules/procedures/controllers/listProceduresController.js
//
// Список вмешательств врача и день врача.
//
//   GET /procedures?kind=&status=&from=&to=&archived=
//   GET /procedures/day/:date        — сутки в зоне расписания врача
//
// «День» отдаёт ещё и приёмы этого дня — не для того, чтобы их показать
// списком, а чтобы календарь записи мог нарисовать занятое время. Без этого
// врач выбирает час, который на сервере окажется занят приёмом, и узнаёт об
// этом только по 409.

import Appointment from "../../../common/models/Appointment/appointment.js";
import ProcedureBooking from "../../../common/models/Procedure/procedureBooking.js";
import {
  ProcedureError,
  resolveDoctorContext,
  dayBounds,
} from "../services/procedure.service.js";
import {
  resolvePatientNames,
  nameOf,
} from "../services/procedureNames.service.js";
import { toProcedureDTO } from "../procedure.mapper.js";
import { tReq } from "../../../common/i18n/index.js";
import { errorText } from "../../../common/i18n/index.js";

const ACTIVE_APPOINTMENT_STATUSES = ["pending", "confirmed"];

function fail(res, err) {
  if (err instanceof ProcedureError) {
    return res.status(err.status || 400).json({
      success: false,
      message: errorText(err, res.req),
      ...(err.code ? { code: err.code } : {}),
    });
  }
  throw err;
}

async function withNames(docs) {
  const names = await resolvePatientNames(docs);
  return docs.map((d) =>
    toProcedureDTO(d, { patientName: nameOf(d, names) }),
  );
}

export const listProceduresController = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: tReq(req, "app.auth.required") });
    }

    let ctx;
    try {
      ctx = await resolveDoctorContext(userId);
    } catch (err) {
      return fail(res, err);
    }

    const query = { doctorId: ctx.doctorId };

    if (req.query.kind) query.kind = String(req.query.kind);
    if (req.query.status) {
      query.status = { $in: String(req.query.status).split(",") };
    }
    // Архив по умолчанию скрыт: врач, открывший список, хочет видеть работу,
    // а не всё, что когда-либо было.
    query.isArchived = req.query.archived === "1";

    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    if ((from && isNaN(+from)) || (to && isNaN(+to))) {
      return res
        .status(400)
        .json({ success: false, message: tReq(req, "app.dateRange.invalid") });
    }
    if (from || to) {
      query.startsAt = {
        ...(from ? { $gte: from } : {}),
        ...(to ? { $lte: to } : {}),
      };
    }

    const docs = await ProcedureBooking.find(query)
      .sort({ startsAt: 1 })
      // Потолок выборки. Без него один запрос без дат вытягивает всю
      // историю врача в память — и делает это тихо, пока она мала.
      .limit(500)
      .lean();

    return res.json({
      success: true,
      procedures: await withNames(docs),
      timezone: ctx.zone,
    });
  } catch (err) {
    console.error("❌ Ошибка listProcedures:", err);
    return res
      .status(500)
      .json({ success: false, message: tReq(req, "app.server.error"), error: errorText(err, req) });
  }
};

export const getProcedureDayController = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: tReq(req, "app.auth.required") });
    }

    let ctx;
    let bounds;
    try {
      ctx = await resolveDoctorContext(userId);
      bounds = dayBounds(req.params.date, ctx.zone);
    } catch (err) {
      return fail(res, err);
    }

    const [procedures, appointments] = await Promise.all([
      ProcedureBooking.find({
        doctorId: ctx.doctorId,
        isArchived: false,
        startsAt: { $lt: bounds.to },
        endsAt: { $gt: bounds.from },
      })
        .sort({ startsAt: 1 })
        .lean(),
      Appointment.find({
        doctorId: ctx.doctorId,
        status: { $in: ACTIVE_APPOINTMENT_STATUSES },
        startsAt: { $lt: bounds.to },
        endsAt: { $gt: bounds.from },
      })
        .select("_id startsAt endsAt type status")
        .sort({ startsAt: 1 })
        .lean(),
    ]);

    return res.json({
      success: true,
      date: req.params.date,
      timezone: ctx.zone,
      procedures: await withNames(procedures),
      // Приёмы — только как занятое время. Ни пациента, ни причины визита:
      // календарю вмешательств они не нужны, а это чужие PHI.
      busy: appointments.map((a) => ({
        _id: String(a._id),
        source: "appointment",
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        type: a.type,
      })),
    });
  } catch (err) {
    console.error("❌ Ошибка getProcedureDay:", err);
    return res
      .status(500)
      .json({ success: false, message: tReq(req, "app.server.error"), error: errorText(err, req) });
  }
};

export default listProceduresController;
