import DoctorSchedule from "../../../common/models/Appointment/doctorSchedule.js";
import Appointment from "../../../common/models/Appointment/appointment.js";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";
import Notification from "../../../common/models/Notification/notification.js";
import { emitNotification } from "../../../common/realtime/userChannel.js";

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
        message: "Необходимо указать doctorId, startsAt и endsAt",
      });
    }

    // === Профиль врача ===
    const doctorProfile =
      (await ProfileDoctor.findById(doctorId)) ||
      (await ProfileDoctor.findOne({ userId: doctorId }));

    if (!doctorProfile) {
      return res
        .status(404)
        .json({ success: false, message: "Профиль врача не найден" });
    }

    // 🔥 ВАЖНО — вытаскиваем userId врача
    const doctorUserId = doctorProfile.userId;

    // === Создание новой записи ===

    // === Запрет врачу записываться на самого себя ===
    if (String(patientId) === String(doctorProfile.userId)) {
      return res.status(400).json({
        success: false,
        message: "Врач не может записаться сам к себе.",
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
        message: "Этот временной слот уже занят. Выберите другое время.",
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
      message: "Запись успешно создана!",
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
      message: "Ошибка сервера при создании записи",
      error: err.message,
    });
  }
};
