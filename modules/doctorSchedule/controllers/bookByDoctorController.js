// server/modules/doctorSchedule/controllers/bookByDoctorController.js
//
// Врач записывает пациента сам — из своего календаря.
//
// POST /schedule/appointment/book-by-doctor
// {
//   startsAt, endsAt?, type: "offline"|"video",
//   patient: { kind: "registered"|"private"|"new",
//              id?,                       // registered: User/карта; private: карточка
//              firstName?, lastName?, phone? },   // new
//   notesDoctor?, offSchedule?: boolean
// }
//
// Три вида пациента сводятся к двум ссылкам на приёме: patientId (аккаунт) и
// privatePatientId (карточка врача). «Человек с улицы» — это та же карточка,
// заведённая одним движением: у DoctorPrivatePatient уже есть шифрование ФИО и
// телефона, blind-index phoneHash для поиска дублей и linkedUserId — когда
// человек зарегистрируется, история приёмов привяжется к аккаунту сама.
//
// doctorId берётся ИЗ СЕССИИ и ниоткуда больше: приняв его из тела запроса,
// мы позволили бы одному врачу занимать расписание другого.

import mongoose from "mongoose";
import crypto from "crypto";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";
import DoctorSchedule from "../../../common/models/Appointment/doctorSchedule.js";
import Appointment from "../../../common/models/Appointment/appointment.js";
import AppointmentAudit from "../../../common/models/Appointment/appointmentAudit.js";
import DoctorPrivatePatient from "../../../common/models/Polyclinic/DoctorPrivatePatient.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import User, { decrypt } from "../../../common/models/Auth/users.js";
import { notify } from "../../notifications/services/notification.service.js";
import { recordActionAsync } from "../../audit/services/audit.service.js";
import {
  buildDaySlots,
  DEFAULT_TZ,
} from "../../../common/services/daySlots.service.js";
import {
  countDoctorPatients,
  resolvePatientLimit,
} from "../../../common/middlewares/requireDoctorPatientLimit.js";
import { DateTime } from "luxon";

const DEFAULT_SLOT_MIN = 20;
// Допуск на запись «в прошлое»: только что начавшийся слот и расхождение часов.
const PAST_GRACE_MS = 5 * 60 * 1000;

function bad(res, message, code = 400, extra = {}) {
  return res.status(code).json({ success: false, message, ...extra });
}

/** Телефон в цифры: хэш-поиск дублей должен быть устойчив к скобкам и пробелам. */
function normalizePhone(v) {
  return String(v || "").replace(/\D/g, "");
}

/**
 * Blind-index телефона — тот же, что считает сеттер поля phoneEncrypted в
 * модели: нормализованный вид "+<цифры>", sha256 от него в нижнем регистре.
 * Повторён здесь, потому что модель хэш наружу не отдаёт, а искать дубль надо
 * ДО создания документа.
 */
function phoneHashOf(digits) {
  if (!digits) return null;
  return crypto.createHash("sha256").update(`+${digits}`).digest("hex");
}

export const bookByDoctorController = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return bad(res, "Требуется авторизация", 401);

    const {
      startsAt,
      startsAtLocal, // "YYYY-MM-DDTHH:MM" в зоне расписания врача
      endsAt,
      type = "offline",
      patient = {},
      notesDoctor = "",
      offSchedule = false,
    } = req.body || {};

    if (!["offline", "video"].includes(type)) return bad(res, "Некорректный тип приёма");

    const profile = await ProfileDoctor.findOne({ userId }).lean();
    if (!profile) return bad(res, "Профиль врача не найден", 404);

    const doctorId = profile._id;
    const schedule = await DoctorSchedule.findOne({ doctorId });
    const zone = schedule?.timezone || DEFAULT_TZ;

    // Слоты сетки приходят готовым UTC-инстантом (startsAt). Ручной ввод
    // «в 14:30» приходит наивным локальным временем: собрать из него инстант
    // может только сервер — зона расписания известна ему, а не браузеру,
    // который вполне может стоять в другом часовом поясе.
    const starts = startsAtLocal
      ? DateTime.fromISO(String(startsAtLocal), { zone }).toUTC().toJSDate()
      : new Date(startsAt);
    if (isNaN(+starts)) return bad(res, "Некорректное время приёма");

    // Записать в прошлое нельзя. Проверка именно на сервере: интерфейс можно
    // обойти, а приём вчерашним числом ломает и напоминания (они смотрят
    // вперёд), и статистику, и саму суть записи.
    // Пять минут допуска — на расхождение часов и на слот, который только что
    // начался: пациент уже в кабинете, врач оформляет его на текущее время.
    if (starts.getTime() < Date.now() - PAST_GRACE_MS) {
      return bad(res, "Нельзя записать на прошедшее время", 400, {
        code: "PAST_TIME",
      });
    }

    // ── Конец приёма ───────────────────────────────────────────────────
    // Если фронт прислал явно — берём его. Иначе шаг слота из расписания на
    // этот день, иначе 20 минут: приём нулевой длины не имеет смысла, а
    // пересечения считаются именно по интервалу.
    let ends = endsAt ? new Date(endsAt) : null;
    if (!ends || isNaN(+ends) || ends <= starts) {
      const dateStr = DateTime.fromJSDate(starts, { zone }).toISODate();
      const built = schedule ? buildDaySlots({ schedule, date: dateStr }) : null;
      const same = built?.slots?.find(
        (s) => new Date(s.start).getTime() === starts.getTime(),
      );
      const stepMin = same
        ? Math.round((new Date(same.end) - new Date(same.start)) / 60000)
        : DEFAULT_SLOT_MIN;
      ends = new Date(starts.getTime() + stepMin * 60000);
    }

    // ── Слот в сетке? ──────────────────────────────────────────────────
    // Врач вправе принять срочного пациента вне расписания, но это должно
    // быть осознанным действием, а не следствием опечатки в дате. Поэтому
    // время вне сетки принимается только с явным offSchedule.
    let inSchedule = false;
    if (schedule) {
      const dateStr = DateTime.fromJSDate(starts, { zone }).toISODate();
      const built = buildDaySlots({ schedule, date: dateStr });
      inSchedule = built.ok
        ? built.slots.some(
            (s) => new Date(s.start).getTime() === starts.getTime(),
          )
        : false;
    }
    if (!inSchedule && !offSchedule) {
      return bad(
        res,
        "Это время вне вашего расписания. Подтвердите запись вне сетки.",
        409,
        { code: "OUT_OF_SCHEDULE" },
      );
    }

    // ── Пересечения ────────────────────────────────────────────────────
    // Транзакция здесь намеренно НЕ используется: одновременную запись на
    // ОДНО и то же начало ловит уникальный partial-индекс {doctorId,startsAt}
    // (ошибка 11000 ниже), а он работает независимо от того, стоит ли Mongo
    // репликой. Проверка ниже закрывает пересечения с разным началом.
    const conflict = await Appointment.findOne({
      doctorId,
      status: { $in: ["pending", "confirmed"] },
      startsAt: { $lt: ends },
      endsAt: { $gt: starts },
    }).lean();

    if (conflict) {
      return bad(res, "Это время уже занято", 409, { code: "SLOT_TAKEN" });
    }

    // ── Кто пациент ────────────────────────────────────────────────────
    let patientId = null;
    let privatePatientId = null;
    let notifyUserId = null; // кому слать уведомление (только аккаунт)
    let patientName = "";

    if (patient.kind === "registered") {
      if (!mongoose.Types.ObjectId.isValid(patient.id)) {
        return bad(res, "Не указан пациент");
      }
      // В patientId исторически кладут то User._id, то id карты поликлиники —
      // принимаем оба и запоминаем, кому уходит уведомление.
      const asUser = await User.findById(patient.id)
        .select("firstNameEncrypted lastNameEncrypted")
        .lean();
      if (asUser) {
        patientId = asUser._id;
        notifyUserId = asUser._id;
        patientName = [
          decrypt(asUser.firstNameEncrypted),
          decrypt(asUser.lastNameEncrypted),
        ]
          .filter(Boolean)
          .join(" ");
      } else {
        const card = await NewPatientPolyclinic.findById(patient.id)
          .select("firstNameEncrypted lastNameEncrypted linkedUserId")
          .lean();
        if (!card) return bad(res, "Пациент не найден", 404);
        patientId = card._id;
        notifyUserId = card.linkedUserId || null;
        patientName = [
          decrypt(card.firstNameEncrypted),
          decrypt(card.lastNameEncrypted),
        ]
          .filter(Boolean)
          .join(" ");
      }
    } else if (patient.kind === "private") {
      if (!mongoose.Types.ObjectId.isValid(patient.id)) {
        return bad(res, "Не указан пациент");
      }
      const card = await DoctorPrivatePatient.findOne({
        _id: patient.id,
        doctorProfileId: doctorId,
      });
      // Фильтр по doctorProfileId — не украшение: без него врач мог бы
      // записать чужую карточку и увидеть её имя в своём календаре.
      if (!card) return bad(res, "Пациент не найден", 404);
      privatePatientId = card._id;
      patientName = card.fullName;
      notifyUserId = card.linkedUserId || null;
    } else if (patient.kind === "new") {
      const firstName = String(patient.firstName || "").trim();
      const lastName = String(patient.lastName || "").trim();
      if (!firstName || !lastName) {
        return bad(res, "Укажите имя и фамилию пациента");
      }

      const phone = normalizePhone(patient.phone);

      // Дубликат по телефону — самая частая ошибка регистратуры: тот же
      // человек звонит второй раз и заводится заново.
      if (phone) {
        const existing = await DoctorPrivatePatient.findOne({
          doctorProfileId: doctorId,
          phoneHash: phoneHashOf(phone),
        });
        if (existing) {
          privatePatientId = existing._id;
          patientName = existing.fullName;
        }
      }

      if (!privatePatientId) {
        const limit = await resolvePatientLimit(userId);
        if (limit !== -1) {
          const current = await countDoctorPatients(userId);
          if (current >= limit) {
            return bad(
              res,
              "Достигнут лимит пациентов по вашему тарифу",
              403,
              { code: "PLAN_LIMIT_REACHED", limit, current },
            );
          }
        }

        const card = new DoctorPrivatePatient({
          doctorProfileId: doctorId,
          doctorUserId: userId,
        });
        // Через виртуалы — они же шифруют и считают blind-index хэши.
        card.firstName = firstName;
        card.lastName = lastName;
        if (phone) card.phoneNumber = phone;
        await card.save();

        privatePatientId = card._id;
        patientName = card.fullName;
      }
    } else {
      return bad(res, "Не указан тип пациента");
    }

    // ── Создание приёма ────────────────────────────────────────────────
    // Статус сразу confirmed: подтверждает приёмы сам врач, и запись,
    // сделанная им же, ждать подтверждения не должна.
    let appt;
    try {
      appt = await Appointment.create({
        doctorId,
        doctorIdUser: userId,
        patientId,
        privatePatientId,
        startsAt: starts,
        endsAt: ends,
        type,
        channel: "internal",
        status: "confirmed",
        bookedBy: "doctor",
        offSchedule: !inSchedule,
        notesDoctor: notesDoctor ? String(notesDoctor).slice(0, 2000) : undefined,
        priceAZN: schedule?.priceAZN || 0,
        createdBy: userId,
      });
    } catch (err) {
      if (err?.code === 11000) {
        return bad(res, "Это время уже занято", 409, { code: "SLOT_TAKEN" });
      }
      throw err;
    }

    // ── Журналы ────────────────────────────────────────────────────────
    await AppointmentAudit.create({
      appointmentId: appt._id,
      action: "create",
      byUserId: userId,
    }).catch((e) =>
      console.error("appointment audit failed:", e?.message),
    );

    // HIPAA-журнал: запись пациента на приём — обращение к его данным.
    // metadata без PHI: имени и телефона здесь быть не должно.
    recordActionAsync({
      actor: { userId: String(userId), role: "doctor" },
      action: "appointment.create",
      resourceType: "appointment",
      resourceId: String(appt._id),
      resourceOwnerId: notifyUserId ? String(notifyUserId) : undefined,
      metadata: {
        bookedBy: "doctor",
        patientKind: patient.kind,
        type,
        offSchedule: !inSchedule,
      },
      context: {
        ipAddress: req.ip,
        userAgent: req.headers?.["user-agent"],
        httpMethod: req.method,
        httpPath: req.originalUrl,
      },
    });

    // ── Уведомление пациенту с аккаунтом ───────────────────────────────
    // Приватному пациенту слать некуда — у него нет аккаунта; врач видит его
    // телефон в карточке. Напоминания (−24ч/−1ч/−10мин) подхватят эту запись
    // сами, они ходят по patientId.
    if (notifyUserId) {
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
        timeZone: zone,
      }).format(starts);

      await notify({
        userId: notifyUserId,
        senderId: userId,
        type: "appointment_booked_by_doctor",
        title: "Вас записали на приём",
        message: `Доктор ${doctorName || ""} записал вас на приём — ${when}.`.replace(
          /\s+/g,
          " ",
        ),
        link: "/patient/my-appointment",
        icon: "calendar",
        meta: { appointmentId: String(appt._id), type },
      }).catch((e) => console.error("notify failed:", e?.message));
    }

    return res.status(201).json({
      success: true,
      appointment: {
        _id: String(appt._id),
        startsAt: appt.startsAt,
        endsAt: appt.endsAt,
        type: appt.type,
        status: appt.status,
        offSchedule: appt.offSchedule,
        patient: { name: patientName, kind: patient.kind },
      },
      notified: Boolean(notifyUserId),
    });
  } catch (err) {
    console.error("❌ Ошибка bookByDoctor:", err);
    return res
      .status(500)
      .json({ success: false, message: "Ошибка сервера", error: err.message });
  }
};

export default bookByDoctorController;
