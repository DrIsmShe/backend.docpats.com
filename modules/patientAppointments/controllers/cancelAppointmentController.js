import mongoose from "mongoose";
import Appointment from "../../../common/models/Appointment/appointment.js";
import AppointmentAudit from "../../../common/models/Appointment/appointmentAudit.js";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import Notification from "../../../common/models/Notification/notification.js";
import { eventBus } from "../../notifications/events/eventBus.js";

/**
 * PUT /appointment-for-patient/cancel/:id
 * Контроллер отмены приёма — работает как для врача, так и для пациента.
 */
export const cancelAppointmentByPatientController = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?._id;
    const { reason } = req.body ?? {};

    console.log("🔍 Cancel request:", { userId, appointmentId: id });

    // --- 1. Проверяем наличие приёма ---
    const appointment = await Appointment.findById(id);
    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: "Приём не найден",
      });
    }

    // --- 2. Находим профиль врача ---
    let profileDoctor = null;
    if (appointment.doctorId) {
      profileDoctor = await ProfileDoctor.findById(appointment.doctorId).lean();
    }
    if (!profileDoctor && userId) {
      profileDoctor = await ProfileDoctor.findOne({ userId }).lean();
    }

    // 🔹 Получаем userId врача (для уведомлений)
    const doctorUserId = profileDoctor?.userId || null;

    // --- 3. Находим профиль пациента ---
    const patientProfile = await NewPatientPolyclinic.findOne({
      linkedUserId: userId,
    }).lean();

    // --- 4. Проверяем статус приёма ---
    if (appointment.status === "completed") {
      return res.status(400).json({
        success: false,
        message: "Невозможно отменить завершённый приём",
      });
    }

    // --- 5. Отменяем приём ---
    appointment.status = "cancelled";
    if (reason) appointment.reason = reason;
    await appointment.save();

    // --- 6. Определяем, кто отменил приём ---
    let byUserRef = null;
    if (profileDoctor && String(profileDoctor._id)) {
      byUserRef = profileDoctor._id;
    } else if (patientProfile && patientProfile._id) {
      byUserRef = patientProfile._id;
    } else {
      byUserRef = userId;
    }

    // --- 7. Создаём запись в аудите ---
    const auditEntry = await AppointmentAudit.create({
      appointmentId: appointment._id,
      targetPatientId: appointment.patientId || patientProfile?._id,
      byUserId: byUserRef,
      action: "cancelled",
      reason,
      timestamp: new Date(),
    });

    // --- 8. Создаём уведомление для врача ---
    try {
      if (doctorUserId) {
        const patientName = patientProfile
          ? `${patientProfile.firstNameEncrypted || "Пациент"} ${
              patientProfile.lastNameEncrypted || ""
            }`
          : "Пациент";

        const appointmentDate = appointment.startsAt
          ? new Date(appointment.startsAt).toLocaleString("ru-RU", {
              dateStyle: "medium",
              timeStyle: "short",
            })
          : "неизвестное время";

        const doctorNotification = await Notification.create({
          userId: doctorUserId, // ✅ врач получает уведомление по userId
          senderId: byUserRef,
          type: "appointment_cancelled",
          title: "Пациент отменил приём",
          message: `${patientName} отменил(а) приём, запланированный на ${appointmentDate}. ${
            reason ? "Причина: " + reason : ""
          }`,
          isRead: false,
          priority: "normal",
          link: `/doctor/appointments/${appointment._id}`,
        });

        console.log("📩 Уведомление врачу отправлено:", doctorNotification._id);

        // --- 🔊 Реальное время (если есть socket.io) ---
        if (global.io) {
          const doctorRoom = String(doctorUserId);
          global.io.to(doctorRoom).emit("new_notification", {
            title: doctorNotification.title,
            message: doctorNotification.message,
            link: doctorNotification.link,
            type: doctorNotification.type,
            createdAt: doctorNotification.createdAt,
          });
          console.log("🚀 Socket.io уведомление врачу доставлено");
        }
      } else {
        console.warn("⚠️ Не найден userId врача — уведомление не создано");
      }
    } catch (notifErr) {
      console.error("❗ Ошибка при создании уведомления врачу:", notifErr);
    }

    // --- 9. Эмитим событие для realtime обновлений ---
    try {
      eventBus.emit("appointment.cancelled", {
        appointmentId: appointment._id,
        doctorId: profileDoctor?._id,
        doctorUserId,
        cancelledBy: byUserRef,
        patientProfileId: patientProfile?._id ?? null,
        reason,
      });
      console.log("⚡ notificationBus → appointment.cancelled emit success");
    } catch (emitErr) {
      console.error("⚡ Ошибка при эмите события notificationBus:", emitErr);
    }

    // --- 10. Возвращаем обновлённые данные ---
    const resultAppointment = await Appointment.findById(
      appointment._id
    ).lean();

    return res.status(200).json({
      success: true,
      message: "Приём успешно отменён",
      data: resultAppointment,
      audit: auditEntry,
    });
  } catch (err) {
    console.error("💥 Ошибка отмены приёма:", err);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при отмене приёма",
    });
  }
};
