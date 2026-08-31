import DoctorSchedule from "../../../common/models/Appointment/doctorSchedule.js";
import Appointment from "../../../common/models/Appointment/appointment.js";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";
import Notification from "../../../common/models/Notification/notification.js";
import { emitNotification } from "../../../common/realtime/userChannel.js";
import { tReq } from "../../../common/i18n/index.js";
import { errorText } from "../../../common/i18n/index.js";

// Допуск на запись «в прошлое» — тот же, что у врача
// (doctorSchedule/bookByDoctorController.js): расхождение часов клиента с
// сервером плюс слот, который начался, пока пациент выбирал время в уже
// открытом списке. Больше пяти минут прощать нечего.
const PAST_GRACE_MS = 5 * 60 * 1000;

/**
 * @desc Пациент записывается на приём к врачу
 * @route POST /appointment-for-patient/book
 * @access Patient
 */
export const bookAppointment = async (req, res) => {
  try {
    const { doctorId, startsAt, endsAt, type, contact } = req.body;

    const patientId = req.userId;

    console.log("📥 [bookAppointment] вход:", {
      doctorId,
      startsAt,
      endsAt,
      type,
      patientId,
      contact,
    });

    // === Проверка входных данных ===
    if (!doctorId || !startsAt || !endsAt) {
      return res.status(400).json({
        success: false,
        message: tReq(req, "app.appointment.requiredFieldsMissing"),
      });
    }

    // === Время приёма должно быть в будущем ===
    //
    // Раньше этой проверки не было вовсе, и запись на вчерашний день
    // создавалась молча — со статусом pending, уведомлением врачу и местом
    // в его календаре. Ни отменить осмысленно, ни провести такой приём
    // нельзя: он уже «прошёл», не начавшись.
    //
    // Проверяем на сервере, а не только скрытием дат в календаре: форму
    // можно отправить и мимо интерфейса, а запись в чужом расписании —
    // не то место, где можно доверять клиенту.
    const startMs = new Date(startsAt).getTime();
    const endMs = new Date(endsAt).getTime();

    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      return res.status(400).json({
        success: false,
        message: tReq(req, "app.appointment.invalidDateTime"),
      });
    }

    if (endMs <= startMs) {
      return res.status(400).json({
        success: false,
        message: tReq(req, "app.appointment.endBeforeStart"),
      });
    }

    if (startMs < Date.now() - PAST_GRACE_MS) {
      return res.status(400).json({
        success: false,
        message: tReq(req, "app.appointment.pastTimeNotAllowed"),
        code: "PAST_TIME",
      });
    }

    // === Профиль врача ===
    const doctorProfile =
      (await ProfileDoctor.findById(doctorId)) ||
      (await ProfileDoctor.findOne({ userId: doctorId }));

    if (!doctorProfile) {
      return res
        .status(404)
        .json({ success: false, message: tReq(req, "app.doctor.profileNotFound") });
    }

    // 🔥 ВАЖНО — вытаскиваем userId врача
    const doctorUserId = doctorProfile.userId;

    // === Создание новой записи ===

    // === Запрет врачу записываться на самого себя ===
    if (String(patientId) === String(doctorProfile.userId)) {
      return res.status(400).json({
        success: false,
        message: tReq(req, "app.appointment.selfBookingNotAllowed"),
      });
    }

    // === Проверка пересечения записей ===
    const overlap = await Appointment.findOne({
      doctorId: doctorProfile._id,
      status: { $in: ["pending", "confirmed"] },
      startsAt: { $lt: new Date(endsAt) },
      endsAt: { $gt: new Date(startsAt) },
    });

    if (overlap) {
      return res.status(400).json({
        success: false,
        message: tReq(req, "app.appointment.timeSlotOccupied"),
      });
    }

    // === Создание новой записи ===
    const newAppointment = await Appointment.create({
      doctorId: doctorProfile._id,
      doctorIdUser: doctorUserId, // ⬅⬅⬅ ДОБАВИЛ ЭТО
      patientId,
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
      type: type || "offline",
      status: "pending",

      // Канал приёма — ВСЕГДА внутренний.
      //
      // Было: `type === "video" ? "whatsapp" : "clinic"`. Две проблемы разом.
      //   1) Любая онлайн-запись помечалась whatsapp-каналом, то есть чужой
      //      мессенджер был каналом телемедицины по умолчанию. Для платформы
      //      с собственным видео, шифрованным чатом и аудитом (hipaa_audit_logs)
      //      это уводило приём туда, где ничего этого нет.
      //   2) "clinic" вообще отсутствует в enum канала
      //      (internal | whatsapp | zoom, common/models/Appointment/appointment.js),
      //      поэтому офлайн-запись падала на ValidationError.
      channel: "internal",

      location: doctorProfile.address || null,
      priceAZN: doctorProfile.priceAZN || 0,
    });
    const formattedDate = new Date(startsAt).toLocaleString("ru-RU");

    /* ===========================================================
       👨‍⚕️ УВЕДОМЛЕНИЕ — ТОЛЬКО ДЛЯ ВРАЧА
       (Создаётся, только если ещё нет такого уведомления)
    ============================================================ */
    const doctorNotificationExists = await Notification.findOne({
      userId: doctorProfile.userId,
      senderId: patientId,
      type: "appointment_booked",
      message: `Пациент записался на ${formattedDate}`,
    });

    let doctorNotification = doctorNotificationExists;
    if (!doctorNotificationExists) {
      doctorNotification = await Notification.create({
        userId: doctorProfile.userId, // врач получает
        senderId: patientId, // пациент инициатор
        type: "appointment_booked",
        title: "Новая запись на приём",
        message: `Пациент записался на ${formattedDate}`,
        i18n: {
          title: "app.notify.newBooking.title",
          message: "app.notify.newBooking.message",
          params: { when: new Date(startsAt).toISOString() },
        },
        link: "/doctor/doctor-appointment",
        isRead: false,
      });
      console.log("📨 Уведомление врачу:", doctorNotification._id);
    } else {
      console.log(
        "⚠️ Уведомление врачу уже существует:",
        doctorNotification._id,
      );
    }

    /* ===========================================================
       👤 УВЕДОМЛЕНИЕ — ТОЛЬКО ДЛЯ ПАЦИЕНТА
       (Создаётся, только если ещё нет такого уведомления)
    ============================================================ */
    const doctorName = `${doctorProfile.lastName || ""} ${
      doctorProfile.firstName || ""
    }`.trim();

    const patientNotificationExists = await Notification.findOne({
      userId: patientId,
      senderId: doctorProfile.userId,
      type: "appointment_booked",
      message: `Вы записались к доктору ${doctorName} на ${formattedDate}`,
    });

    let patientNotification = patientNotificationExists;
    if (!patientNotificationExists) {
      patientNotification = await Notification.create({
        userId: patientId, // получает пациент
        senderId: doctorProfile.userId, // отправитель — врач
        type: "appointment_booked",
        title: "Запись успешно создана",
        message: `Вы записались к доктору ${doctorName} на ${formattedDate}`,
        i18n: {
          title: "app.notify.bookingCreated.title",
          message: "app.notify.bookingCreated.message",
          params: { doctorName, when: new Date(startsAt).toISOString() },
        },
        link: "/patient/my-appointment",
        isRead: false,
      });
      console.log("📨 Уведомление пациенту:", patientNotification._id);
    } else {
      console.log(
        "⚠️ Уведомление пациенту уже существует:",
        patientNotification._id,
      );
    }

    /* ===========================================================
       🔊 Socket.io — оповещения в реальном времени
    ============================================================ */
    try {
      // Личный канал /communication + user:<id>. Прежний global.io нигде не
      // присваивался, так что эти два уведомления никогда не уходили.
      emitNotification(doctorProfile.userId, doctorNotification);
      emitNotification(patientId, patientNotification);
    } catch (socketError) {
      console.error("❌ Ошибка Socket.io:", socketError);
    }

    /* ===========================================================
       ✅ Ответ клиенту
    ============================================================ */
    return res.status(201).json({
      success: true,
      message: tReq(req, "app.appointment.createdSuccessfully"),
      appointment: newAppointment,
      notifications: {
        doctor: doctorNotification._id,
        patient: patientNotification._id,
      },
    });
  } catch (err) {
    console.error("❌ Ошибка бронирования:", err);
    return res.status(500).json({
      success: false,
      message: tReq(req, "app.appointment.serverErrorOnCreate"),
      error: errorText(err, req),
    });
  }
};
