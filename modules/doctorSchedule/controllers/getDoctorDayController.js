// server/modules/doctorSchedule/controllers/getDoctorDayController.js
//
// День врача: те же слоты, что видит пациент, но с пометкой «занято/свободно»
// и с именем пациента там, где занято.
//
// Появился потому, что календарь в кабинете врача рисовал десять строк с 08:00
// до 17:00, никак не связанных с расписанием: пациент выбирал время из
// настоящего генератора (интервалы по дням недели, свой шаг слота, зона), а
// врач смотрел на выдуманную сетку. Записывать пациента из выдуманной сетки
// нельзя — слот, которого нет в расписании, пациенту не показался бы никогда.
//
// GET /schedule/doctor-schedule/day/:date        (?type=offline|video)

import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";
import DoctorSchedule from "../../../common/models/Appointment/doctorSchedule.js";
import Appointment from "../../../common/models/Appointment/appointment.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import DoctorPrivatePatient from "../../../common/models/Polyclinic/DoctorPrivatePatient.js";
import User, { decrypt } from "../../../common/models/Auth/users.js";
import {
  buildDaySlots,
  dayBoundsUtc,
  DEFAULT_TZ,
} from "../../../common/services/daySlots.service.js";

const ACTIVE = ["pending", "confirmed"];

/** ФИО из зашифрованных полей любой из трёх коллекций — формат шифра общий. */
function nameOf(doc) {
  if (!doc) return "";
  return [decrypt(doc.firstNameEncrypted), decrypt(doc.lastNameEncrypted)]
    .filter(Boolean)
    .join(" ")
    .trim();
}

/**
 * Достаёт имена пациентов для списка приёмов одним заходом на коллекцию.
 * Пациент с аккаунтом может лежать и в User, и в карте поликлиники —
 * исторически в patientId пишут то одно, то другое.
 */
async function attachPatients(appointments) {
  const ids = appointments.map((a) => a.patientId).filter(Boolean);
  const privateIds = appointments.map((a) => a.privatePatientId).filter(Boolean);

  const [users, cards, privates] = await Promise.all([
    ids.length
      ? User.find({ _id: { $in: ids } })
          .select("firstNameEncrypted lastNameEncrypted")
          .lean()
      : [],
    ids.length
      ? NewPatientPolyclinic.find({ _id: { $in: ids } })
          .select("firstNameEncrypted lastNameEncrypted")
          .lean()
      : [],
    privateIds.length
      ? DoctorPrivatePatient.find({ _id: { $in: privateIds } })
          .select("firstNameEncrypted lastNameEncrypted phoneEncrypted")
          .lean()
      : [],
  ]);

  const byId = new Map();
  for (const d of [...users, ...cards]) {
    byId.set(String(d._id), { name: nameOf(d), kind: "registered" });
  }
  for (const d of privates) {
    byId.set(String(d._id), {
      name: nameOf(d),
      kind: "private",
      phone: decrypt(d.phoneEncrypted) || null,
    });
  }

  return appointments.map((a) => ({
    _id: String(a._id),
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    type: a.type,
    status: a.status,
    bookedBy: a.bookedBy || "patient",
    offSchedule: Boolean(a.offSchedule),
    patient:
      byId.get(String(a.patientId)) ||
      byId.get(String(a.privatePatientId)) ||
      null,
  }));
}

export const getDoctorDayController = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Требуется авторизация" });
    }

    const { date } = req.params;
    const { type = null } = req.query;

    const profile = await ProfileDoctor.findOne({ userId }).lean();
    if (!profile) {
      return res
        .status(404)
        .json({ success: false, message: "Профиль врача не найден" });
    }

    const schedule = await DoctorSchedule.findOne({ doctorId: profile._id });
    const zone = schedule?.timezone || DEFAULT_TZ;

    // Приёмы дня грузим ВСЕГДА — даже когда расписания нет вовсе. Иначе врач,
    // ещё не заполнивший расписание, не увидит записей, сделанных вне сетки.
    const { startUtc, endUtc } = dayBoundsUtc(date, zone);

    // ПРОШЛОЕ ПОКАЗЫВАЕМ ЦЕЛИКОМ.
    //
    // Для будущего «занято» — это только живая запись: pending/confirmed и не
    // в архиве. Отменённая или удалённая в архив запись не должна держать
    // слот, иначе врач не сможет записать туда никого.
    //
    // Для прошедшего времени правило обратное. Врач приходит в прошлый месяц
    // не записывать, а смотреть, кто у него был, — и там нужны все приёмы:
    // completed, no_show, отменённые и, главное, архивные. Приёмы старше семи
    // дней уходят в архив автоматически (jobs/autoCleanAppointments.js), так
    // что без этой ветки прошлый месяц выглядел бы пустым днём.
    const now = new Date();
    const dayAppointments = await Appointment.find({
      doctorId: profile._id,
      startsAt: { $gte: startUtc, $lt: endUtc },
      $or: [
        { status: { $in: ACTIVE }, isArchived: { $ne: true } },
        { startsAt: { $lt: now } },
      ],
    })
      .sort({ startsAt: 1 })
      .lean();

    const enriched = await attachPatients(dayAppointments);
    const byStart = new Map(
      enriched.map((a) => [new Date(a.startsAt).getTime(), a]),
    );

    const built = schedule
      ? buildDaySlots({ schedule, date, type })
      : { ok: false, reason: "no_schedule", zone, slots: [] };

    if (!built.ok && built.reason === "invalid_date") {
      return res
        .status(400)
        .json({ success: false, message: "Некорректная дата" });
    }

    const slots = built.slots.map((s) => {
      const appt = byStart.get(new Date(s.start).getTime());
      if (appt) byStart.delete(new Date(s.start).getTime());
      return {
        ...s,
        status: appt ? "busy" : "free",
        appointment: appt || null,
      };
    });

    // Всё, что осталось несопоставленным, — приёмы вне сетки: срочный пациент,
    // изменившееся расписание, старая запись. Врач обязан их видеть, иначе
    // «свободный» день окажется занятым.
    const extra = [...byStart.values()].map((appt) => ({
      start: new Date(appt.startsAt).toISOString(),
      end: new Date(appt.endsAt).toISOString(),
      type: appt.type,
      status: "busy",
      outOfSchedule: true,
      appointment: appt,
    }));

    const all = [...slots, ...extra].sort(
      (a, b) => new Date(a.start) - new Date(b.start),
    );

    return res.json({
      success: true,
      date,
      timezone: zone,
      hasSchedule: Boolean(schedule),
      reason: built.ok ? null : built.reason, // day_off | no_intervals | no_schedule
      doctorId: String(profile._id),
      slots: all,
      total: all.length,
    });
  } catch (err) {
    console.error("❌ Ошибка getDoctorDay:", err);
    return res
      .status(500)
      .json({ success: false, message: "Ошибка сервера", error: err.message });
  }
};

export default getDoctorDayController;
