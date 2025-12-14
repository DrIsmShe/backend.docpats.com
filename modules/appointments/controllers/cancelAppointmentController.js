// controllers/appointments/cancelAppointmentController.js
import Appointment from "../../common/models/Appointment/appointment.js";
import AppointmentAudit from "../../common/models/Appointment/appointmentAudit.js";

export const cancelAppointmentController = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const appt = await Appointment.findById(id);
    if (!appt)
      return res.status(404).json({ success: false, message: "Not found" });

    if (!["pending", "confirmed"].includes(appt.status)) {
      return res.status(400).json({
        success: false,
        message: "Only pending/confirmed can be cancelled",
      });
    }

    // Политика: если до визита < 24ч и оплата была — удержание/без возврата
    const hoursBefore = (appt.startsAt - new Date()) / 36e5;
    const lateCancel = hoursBefore < 24;

    appt.status = "cancelled";
    appt.updatedBy = req.userId;

    // возвраты/штрафы (заглушка)
    if (appt.payment.required && appt.payment.status === "paid") {
      if (lateCancel) {
        // без возврата
      } else {
        appt.payment.status = "refunded";
        appt.payment.refundedAt = new Date();
        appt.status = "refunded";
      }
    }
    await appt.save();

    await AppointmentAudit.create({
      appointmentId: appt._id,
      action: "cancel",
      byUserId: req.userId,
      reason,
    });

    res.json({ success: true, appointment: appt, lateCancel });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
