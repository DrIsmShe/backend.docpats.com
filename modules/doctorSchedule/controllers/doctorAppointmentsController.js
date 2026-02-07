import mongoose from "mongoose";
import Appointment from "../../../common/models/Appointment/appointment.js";
import AppointmentAudit from "../../../common/models/Appointment/appointmentAudit.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";
import User from "../../../common/models/Auth/users.js";
import { eventBus } from "../../notifications/events/eventBus.js"; // ✅ добавлено
import Notification from "../../../common/models/Notification/notification.js"; // ✅ добавлено
export const getMyAppointments = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Требуется авторизация",
      });
    }

    // 🔹 Находим профиль врача по userId
    const doctorProfile = await ProfileDoctor.findOne({ userId }).lean();

    if (!doctorProfile) {
      return res.status(404).json({
        success: false,
        message: "Профиль врача не найден",
      });
    }

    // 🔹 Теперь ищем приёмы по doctorProfile._id
    const appointments = await Appointment.find({
      doctorId: doctorProfile._id,
    })
      .sort({ startsAt: 1 })
      .lean();

    if (!appointments.length) {
      return res.status(200).json({
        success: true,
        message: "У вас пока нет назначенных приёмов.",
        data: [],
      });
    }

    // Извлекаем все patientId
    const patientObjectIds = [
      ...new Set(
        appointments
          .map((a) =>
            mongoose.Types.ObjectId.isValid(a.patientId)
              ? new mongoose.Types.ObjectId(a.patientId)
              : null
          )
          .filter(Boolean)
      ),
    ];

    // Загружаем пациентов из обеих коллекций
    const [patientsPolyclinic, patientsUser] = await Promise.all([
      NewPatientPolyclinic.find({ _id: { $in: patientObjectIds } })
        .select(
          "firstNameEncrypted lastNameEncrypted emailEncrypted photo country"
        )
        .lean(),
      User.find({ _id: { $in: patientObjectIds } })
        .select(
          "firstNameEncrypted lastNameEncrypted emailEncrypted profileImage country"
        )
        .lean(),
    ]);

    const allPatients = [...patientsPolyclinic, ...patientsUser];

    // Функция расшифровки
    const crypto = await import("crypto");
    const RAW_KEY = process.env.ENCRYPTION_KEY || "default_secret_key";
    const SECRET_KEY = RAW_KEY.padEnd(32, "0").slice(0, 32);

    const decrypt = (cipherText) => {
      if (!cipherText || typeof cipherText !== "string") return "";
      try {
        const [ivHex, dataHex] = cipherText.split(":");
        const iv = Buffer.from(ivHex, "hex");
        const data = Buffer.from(dataHex, "hex");
        const decipher = crypto.default.createDecipheriv(
          "aes-256-cbc",
          Buffer.from(SECRET_KEY),
          iv
        );
        const decrypted = Buffer.concat([
          decipher.update(data),
          decipher.final(),
        ]);
        return decrypted.toString("utf8");
      } catch {
        return "";
      }
    };

    // Создаём мап по пациентам
    const patientMap = {};
    for (const p of allPatients) {
      patientMap[p._id.toString()] = {
        firstName: decrypt(p.firstNameEncrypted),
        lastName: decrypt(p.lastNameEncrypted),
        email: decrypt(p.emailEncrypted),
        photo: p.photo || p.profileImage || null,
        country: p.country || null,
      };
    }

    // Обогащаем приёмы
    const enrichedAppointments = appointments.map((a) => ({
      ...a,
      patient: patientMap[a.patientId?.toString()] || null,
      formattedTime: new Date(a.startsAt).toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    }));

    return res.status(200).json({
      success: true,
      data: enrichedAppointments,
    });
  } catch (err) {
    console.error("❌ Ошибка getMyAppointments:", err);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при получении приёмов.",
      error: err.message,
    });
  }
};
// ✅ правильный синтаксис
export const updateAppointmentStatus = async (req, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const { status, reason } = req.body;

    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Неавторизованный доступ" });
    }

    // 🔹 Проверяем допустимость статуса
    const validStatuses = ["confirmed", "cancelled", "completed", "pending"];
    if (!validStatuses.includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Недопустимый статус" });
    }

    // 🔹 Находим профиль врача
    const doctorProfile = await ProfileDoctor.findOne({ userId }).lean();
    if (!doctorProfile) {
      return res.status(404).json({
        success: false,
        message: "Профиль врача не найден",
      });
    }

    // 🔹 Обновляем приём
    const appointment = await Appointment.findOneAndUpdate(
      { _id: id, doctorId: doctorProfile._id },
      { status },
      { new: true }
    );

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: "Приём не найден для этого врача",
      });
    }

    // 🔹 Логируем изменение
    await AppointmentAudit.create({
      appointmentId: appointment._id,
      action: status,
      byUserId: userId,
      reason: reason || `Статус изменён на "${status}"`,
      timestamp: new Date(),
    });

    // ======================================================
    // 🔔 Отправляем уведомления
    // ======================================================

    // Находим пациента, чтобы уточнить данные
    const patient = await NewPatientPolyclinic.findById(appointment.patientId)
      .select("linkedUserId firstName lastName")
      .lean();

    const patientUserId =
      patient?.linkedUserId || appointment.patientId || null;

    // Форматируем дату
    const formattedDate = new Date(appointment.startsAt).toLocaleString(
      "ru-RU"
    );
    const doctorName = `${doctorProfile.lastName || ""} ${
      doctorProfile.firstName || ""
    }`.trim();

    // 🟢 Приём подтверждён
    if (status === "confirmed" && patientUserId) {
      eventBus.emit("appointment.confirmed", {
        patientId: patientUserId,
        doctorName,
        startsAt: appointment.startsAt,
        appointmentId: appointment._id,
      });
      console.log("📨 Уведомление о подтверждении отправлено пациенту");
    }

    // 🔴 Приём отменён
    if (status === "cancelled" && patientUserId) {
      // 📩 EventBus уведомление
      eventBus.emit("appointment.cancelled.byDoctor", {
        patientId: patientUserId,
        doctorName,
        appointmentId: appointment._id,
      });

      // 📩 Прямое уведомление в коллекции Notification
      const patientNotification = await Notification.create({
        userId: patientUserId,
        senderId: userId,
        type: "appointment_cancelled",
        title: "Приём отменён врачом",
        message: `Ваш приём у доктора ${doctorName} (${formattedDate}) был отменён.`,
        link: "/patient/my-appointment",
        isRead: false,
      });

      console.log("📨 Уведомление об отмене создано:", patientNotification._id);

      // 📡 Отправляем по Socket.io, если подключено
      try {
        if (global.io) {
          global.io.to(String(patientUserId)).emit("new_notification", {
            title: patientNotification.title,
            message: patientNotification.message,
            link: patientNotification.link,
            type: patientNotification.type,
            createdAt: patientNotification.createdAt,
          });
          console.log("🚀 Socket.io уведомление пациенту отправлено");
        }
      } catch (socketErr) {
        console.error("⚠️ Ошибка при отправке socket уведомления:", socketErr);
      }
    }

    // 🟣 Приём завершён
    if (status === "completed" && patientUserId) {
      eventBus.emit("system.message", {
        userId: patientUserId,
        title: "Приём завершён",
        message: `Ваш приём у доктора ${doctorName} (${formattedDate}) завершён.`,
        link: `/patient/my-appointment`,
      });
      console.log("📨 Уведомление о завершении отправлено пациенту");
    }

    // ======================================================
    // ✅ Возвращаем ответ
    // ======================================================
    return res.json({
      success: true,
      message: `Статус приёма обновлён: ${status}`,
      data: appointment,
    });
  } catch (err) {
    console.error("❌ Ошибка updateAppointmentStatus:", err);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при обновлении статуса.",
      error: err.message,
    });
  }
};
