// controllers/appointments/confirmAppointmentController.js
import Appointment from "../../common/models/Appointment/appointment.js";
import AppointmentAudit from "../../common/models/Appointment/appointmentAudit.js";

export const confirmAppointmentController = async (req, res) => {
  try {
    const { id } = req.params; // appointmentId
    const appt = await Appointment.findById(id);
    if (!appt)
      return res.status(404).json({ success: false, message: "Not found" });

    if (appt.status !== "pending") {
      return res
        .status(400)
        .json({ success: false, message: "Only pending can be confirmed" });
    }

    // Если требуется оплата — остаётся "pending" до authorizе? Вариант:
    if (
      appt.payment.required &&
      appt.payment.status !== "authorized" &&
      appt.payment.status !== "paid"
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Payment not authorized yet" });
    }

    appt.status = "confirmed";
    appt.updatedBy = req.userId;
    await appt.save();

    await AppointmentAudit.create({
      appointmentId: appt._id,
      action: "confirm",
      byUserId: req.userId,
    });

    res.json({ success: true, appointment: appt });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
