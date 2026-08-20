// server/jobs/appointmentReminders.job.js
// ─────────────────────────────────────────────────────────────────────
//   Напоминания о приёме: −24 часа, −1 час, −10 минут.
//
//   Обеим сторонам: и пациенту, и врачу. Врач забывает о приёме ровно так
//   же, как пациент, а неявка врача стоит платформе дороже.
//
//   Каналы (все уже существовали, не хватало только этой задачи):
//     • колокольчик + web-push  — через notify() (notifications/services)
//     • e-mail                  — только на −24ч, чтобы не превратиться в спам
//
//   Зачем лестница, а не один сигнал в момент приёма:
//     −24ч  можно переставить день, если не получается (главный рычаг против неявок)
//     −1ч   можно доехать / освободиться
//     −10м  можно открыть комнату и проверить камеру
//   Один сигнал ровно в 13:00 приходит, когда сделать уже ничего нельзя.
//
//   Автозвонок в момент X сознательно НЕ делается: врач опаздывает с
//   предыдущего приёма, и пациент получил бы звонок в пустоту. Звонок
//   инициирует человек — за это отвечает сигнализация звонков
//   (call.gateway.js), а задача лишь приводит обоих к экрану вовремя.
//
//   Подключение (index.js):
//     import { scheduleAppointmentReminders } from "./jobs/appointmentReminders.job.js";
//     scheduleAppointmentReminders();
// ─────────────────────────────────────────────────────────────────────

import cron from "node-cron";
import mongoose from "mongoose";
import Appointment from "../common/models/Appointment/appointment.js";
import DoctorSchedule from "../common/models/Appointment/doctorSchedule.js";
import NewPatientPolyclinic from "../common/models/Polyclinic/newPatientPolyclinic.js";
import User from "../common/models/Auth/users.js";
import { notify } from "../modules/notifications/services/notification.service.js";
import { sendEmail } from "../common/services/emailService.js";

const MIN = 60 * 1000;

// Ступени лестницы. Порядок — от дальней к ближней; код полагается на него
// при выборе самой срочной из просроченных ступеней.
const STAGES = [
  { key: "sent24h", lead: 24 * 60 * MIN, code: "h24", email: true },
  { key: "sent1h", lead: 60 * MIN, code: "h1", email: false },
  { key: "sent10m", lead: 10 * MIN, code: "m10", email: false },
];

// ─── Тексты ───────────────────────────────────────────────────────────
// Пять локалей платформы. Строки короткие намеренно: напоминание читают с
// экрана блокировки телефона, и всё, что не поместилось в две строки, до
// человека не доходит.
//
// ⚠️ В тексте НЕТ диагноза, жалобы и причины обращения — только факт приёма
// и время. Пуш проходит через чужой сервис (FCM/APNs) и показывается на
// заблокированном экране: это не место для PHI.
const TEXT = {
  ru: {
    title: { h24: "Приём завтра", h1: "Приём через час", m10: "Приём через 10 минут" },
    patient: (when, who) => `Приём у ${who} — ${when}.`,
    doctor: (when, who) => `Приём с пациентом ${who} — ${when}.`,
    online: " Онлайн: подключитесь из личного кабинета.",
    pending: " Приём ещё не подтверждён.",
    emailSubject: "Напоминание о приёме",
  },
  en: {
    title: { h24: "Appointment tomorrow", h1: "Appointment in an hour", m10: "Appointment in 10 minutes" },
    patient: (when, who) => `Appointment with ${who} — ${when}.`,
    doctor: (when, who) => `Appointment with patient ${who} — ${when}.`,
    online: " Online: join from your dashboard.",
    pending: " The appointment is not confirmed yet.",
    emailSubject: "Appointment reminder",
  },
  az: {
    title: { h24: "Sabah qəbul", h1: "Bir saatdan sonra qəbul", m10: "10 dəqiqədən sonra qəbul" },
    patient: (when, who) => `${who} ilə qəbul — ${when}.`,
    doctor: (when, who) => `Pasiyent ${who} ilə qəbul — ${when}.`,
    online: " Onlayn: şəxsi kabinetdən qoşulun.",
    pending: " Qəbul hələ təsdiqlənməyib.",
    emailSubject: "Qəbul barədə xatırlatma",
  },
  tr: {
    title: { h24: "Yarın randevu", h1: "Bir saat sonra randevu", m10: "10 dakika sonra randevu" },
    patient: (when, who) => `${who} ile randevu — ${when}.`,
    doctor: (when, who) => `${who} adlı hasta ile randevu — ${when}.`,
    online: " Çevrimiçi: panelinizden katılın.",
    pending: " Randevu henüz onaylanmadı.",
    emailSubject: "Randevu hatırlatması",
  },
  ar: {
    title: { h24: "موعد غدًا", h1: "موعد بعد ساعة", m10: "موعد بعد ١٠ دقائق" },
    patient: (when, who) => `موعد مع ${who} — ${when}.`,
    doctor: (when, who) => `موعد مع المريض ${who} — ${when}.`,
    online: " عبر الإنترنت: انضم من حسابك.",
    pending: " لم يتم تأكيد الموعد بعد.",
    emailSubject: "تذكير بالموعد",
  },
};

const LOCALE_TAG = {
  ru: "ru-RU",
  en: "en-GB",
  az: "az-AZ",
  tr: "tr-TR",
  ar: "ar-AE",
};

function dict(lang) {
  return TEXT[lang] || TEXT.ru;
}

/**
 * Время приёма словами получателя: его язык, часовой пояс расписания врача.
 * Записи хранятся в UTC — показать их как есть значит промахнуться на часы.
 */
function formatWhen(startsAt, lang, timezone) {
  try {
    return new Intl.DateTimeFormat(LOCALE_TAG[lang] || "ru-RU", {
      day: "2-digit",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone || "Asia/Baku",
    }).format(new Date(startsAt));
  } catch {
    // Неизвестная зона в базе не должна отменять напоминание.
    return new Date(startsAt).toISOString().slice(0, 16).replace("T", " ");
  }
}

/** Имя пользователя из зашифрованных полей. Пустая строка вместо падения. */
function nameOf(userDoc) {
  if (!userDoc) return "";
  try {
    if (typeof userDoc.decryptFields === "function") {
      const { firstName, lastName } = userDoc.decryptFields();
      return [firstName, lastName].filter(Boolean).join(" ");
    }
  } catch {
    /* имя не критично — напоминание уходит и без него */
  }
  return "";
}

function emailOf(userDoc) {
  try {
    if (typeof userDoc?.decryptFields === "function") {
      return userDoc.decryptFields()?.email || null;
    }
  } catch {
    /* без почты — только пуш и колокольчик */
  }
  return null;
}

/**
 * Пациент приёма как аккаунт User.
 *
 * Поле patientId объявлено ссылкой на NewPatientPolyclinic, но запись через
 * /appointment-for-patient/book кладёт туда userId пациента напрямую. Живут
 * оба варианта, поэтому проверяем сначала User, потом карту поликлиники.
 * Иначе половина напоминаний ушла бы в никуда.
 */
async function resolvePatientUser(patientId) {
  if (!patientId || !mongoose.Types.ObjectId.isValid(patientId)) return null;
  const asUser = await User.findById(patientId).catch(() => null);
  if (asUser) return asUser;
  const card = await NewPatientPolyclinic.findById(patientId)
    .select("linkedUserId")
    .catch(() => null);
  if (!card?.linkedUserId) return null;
  return User.findById(card.linkedUserId).catch(() => null);
}

/** Часовой пояс врача из его расписания. */
async function doctorTimezone(doctorId) {
  const sch = await DoctorSchedule.findOne({ doctorId })
    .select("timezone")
    .lean()
    .catch(() => null);
  return sch?.timezone || "Asia/Baku";
}

/**
 * Одно напоминание одному человеку.
 * Никогда не бросает: сбой у одной стороны не должен лишать напоминания вторую.
 */
async function remindOne({ user, role, appt, stageCode, when, peerName, sendMail }) {
  if (!user?._id) return false;
  const lang = user.preferredLanguage || "ru";
  const d = dict(lang);

  let body =
    role === "doctor"
      ? d.doctor(when, peerName || "—")
      : d.patient(when, peerName || "—");

  if (appt.type === "video") body += d.online;
  if (appt.status === "pending") body += d.pending;

  const link =
    role === "doctor" ? "/doctor/doctor-appointment" : "/patient/my-appointment";

  try {
    await notify({
      userId: user._id,
      type: "appointment_reminder",
      title: d.title[stageCode],
      message: body,
      link,
      icon: "clock",
      // −10 минут — единственная ступень, ради которой стоит подсветить
      // колокольчик: остальные две человек ещё успеет прочитать спокойно.
      priority: stageCode === "m10" ? "high" : "normal",
      // meta без PHI: только структура — так требует правило аудита.
      meta: {
        appointmentId: String(appt._id),
        stage: stageCode,
        type: appt.type,
        startsAt: appt.startsAt,
      },
    });
  } catch (err) {
    console.error("[appt-reminder] notify failed:", err?.message);
  }

  if (sendMail) {
    const email = emailOf(user);
    if (email) {
      await sendEmail(email, d.emailSubject, body).catch(() => {});
    }
  }

  return true;
}

// ─── Главный проход ──────────────────────────────────────────────────
export async function runAppointmentReminders() {
  const now = new Date();
  const horizon = new Date(now.getTime() + STAGES[0].lead);

  // Берём всё, что начнётся в ближайшие сутки и ещё не отработало все ступени.
  // Условие «хотя бы один флаг пуст» пишем через $or — иначе на каждый тик
  // поднимались бы все завтрашние приёмы целиком.
  const appts = await Appointment.find({
    startsAt: { $gt: now, $lte: horizon },
    status: { $in: ["pending", "confirmed"] },
    isArchived: { $ne: true },
    $or: [
      { "reminders.sent24h": null },
      { "reminders.sent1h": null },
      { "reminders.sent10m": null },
    ],
  })
    .select("_id doctorId doctorIdUser patientId startsAt type status reminders")
    .limit(500);

  if (!appts.length) return { checked: 0, sent: 0 };

  let sent = 0;

  for (const appt of appts) {
    try {
      const msLeft = new Date(appt.startsAt).getTime() - now.getTime();

      // Просроченные ступени: все, чей порог уже пройден и кто ещё не отмечен.
      // Сервер мог лежать или запись могли создать за 20 минут до приёма —
      // тогда «просрочено» сразу несколько ступеней.
      const due = STAGES.filter(
        (s) => msLeft <= s.lead && !appt.reminders?.[s.key],
      );
      if (!due.length) continue;

      // Отправляем ТОЛЬКО самую срочную, остальные просто закрываем. Иначе
      // запись, созданная за полчаса до приёма, выдала бы три уведомления
      // подряд — верный способ научить человека их игнорировать.
      const stage = due[due.length - 1];

      // Атомарная заявка на отправку: фильтр требует, чтобы флаг был всё ещё
      // пуст. Два инстанса PM2 не разошлют одно напоминание дважды —
      // updateOne выиграет ровно один.
      const set = {};
      for (const s of due) set[`reminders.${s.key}`] = new Date();
      const claim = await Appointment.updateOne(
        { _id: appt._id, [`reminders.${stage.key}`]: null },
        { $set: set },
      );
      if (!claim.modifiedCount) continue;

      const [doctorUser, patientUser, tz] = await Promise.all([
        User.findById(appt.doctorIdUser).catch(() => null),
        resolvePatientUser(appt.patientId),
        doctorTimezone(appt.doctorId),
      ]);

      const doctorName = nameOf(doctorUser);
      const patientName = nameOf(patientUser);

      if (patientUser) {
        await remindOne({
          user: patientUser,
          role: "patient",
          appt,
          stageCode: stage.code,
          when: formatWhen(
            appt.startsAt,
            patientUser.preferredLanguage || "ru",
            tz,
          ),
          peerName: doctorName,
          sendMail: stage.email,
        });
        sent += 1;
      }

      if (doctorUser) {
        await remindOne({
          user: doctorUser,
          role: "doctor",
          appt,
          stageCode: stage.code,
          when: formatWhen(
            appt.startsAt,
            doctorUser.preferredLanguage || "ru",
            tz,
          ),
          peerName: patientName,
          sendMail: stage.email,
        });
        sent += 1;
      }
    } catch (err) {
      console.error("[appt-reminder] appointment failed:", err?.message);
    }
  }

  return { checked: appts.length, sent };
}

// ─── Планировщик ─────────────────────────────────────────────────────
// Каждые 5 минут. Чаще незачем: самая точная ступень — «за 10 минут», и
// разброс в пределах пяти минут человек не замечает. Реже — уже заметит.
let running = false;

export function scheduleAppointmentReminders(expr = "*/5 * * * *") {
  cron.schedule(expr, async () => {
    if (running) return; // предыдущий проход ещё идёт — пропускаем такт
    running = true;
    try {
      const res = await runAppointmentReminders();
      if (res.sent > 0) {
        console.log(
          `⏰ Напоминания о приёмах: проверено ${res.checked}, отправлено ${res.sent}`,
        );
      }
    } catch (err) {
      console.error("❌ Ошибка напоминаний о приёмах:", err);
    } finally {
      running = false;
    }
  });
  console.log("⏳ Планировщик напоминаний о приёмах активен");
}

export default { runAppointmentReminders, scheduleAppointmentReminders };
