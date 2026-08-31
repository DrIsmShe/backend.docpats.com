import Appointment from "../../../common/models/Appointment/appointment.js";
import AppointmentAudit from "../../../common/models/Appointment/appointmentAudit.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import { tReq } from "../../../common/i18n/index.js";
/**
 * 📅 Контроллер: создание или обновление расписания врача
 * - Создаёт новое расписание, если его нет
 * - Обновляет существующее (рабочие дни, исключения)
 * - Добавляет запись в AppointmentAudit для истории действий
 */
export const addOrUpdateScheduleController = async (req, res) => {
  try {
    const doctorId = req.userId;
    const { id } = req.params;
    const { status, reason } = req.body;

    if (!doctorId) {
      return res
        .status(401)
        .json({ success: false, message: tReq(req, "app.access.unauthorized") });
    }

    const validStatuses = [
      "confirmed",
      "cancelled",
      "completed",
      "pending",
      "rescheduled",
    ];
    if (!validStatuses.includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: tReq(req, "app.appointment.status.invalid") });
    }

    // 🔹 Обновляем статус
    const appointment = await Appointment.findOneAndUpdate(
      { _id: id, doctorId },
      { status },
      { new: true }
    );

    if (!appointment) {
      return res
        .status(404)
        .json({ success: false, message: tReq(req, "app.appointment.notFound") });
    }

    // 🔍 Ищем пациента через NewPatientPolyclinic
    const patient = await NewPatientPolyclinic.findOne({
      _id: appointment.patientId,
    }).lean();

    // 🧾 Запись в журнал
    await AppointmentAudit.create({
      appointmentId: appointment._id,
      byUserId: doctorId,
      targetPatientId: appointment.patientId, // 🔹 вот это нужно добавить!
      action: status,
      reason: reason || `Статус изменён на "${status}"`,
      meta: {
        ip: req.ip || null,
        userAgent: req.headers["user-agent"] || null,
        device: req.headers["sec-ch-ua-platform"] || "unknown",
      },
      isSystem: false,
    });

    res.status(200).json({
      success: true,
      message: `Статус приёма изменён на "${status}"`,
      data: appointment,
    });
  } catch (error) {
    console.error("❌ Ошибка updateAppointmentStatus:", error);
    res.status(500).json({
      success: false,
      message: tReq(req, "app.appointment.status.updateError"),
    });
  }
};
