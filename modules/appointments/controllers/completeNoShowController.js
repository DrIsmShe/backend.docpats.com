// controllers/appointments/completeNoShowController.js
import Appointment from "../../common/models/Appointment/appointment.js";
import AppointmentAudit from "../../common/models/Appointment/appointmentAudit.js";

export const completeAppointmentController = async (req, res) => {
  const { id } = req.params;
  const appt = await Appointment.findById(id);
  if (!appt) return res.status(404).json({ success: false });
  if (appt.status !== "confirmed")
    return res.status(400).json({ success: false, message: "Not confirmed" });

  appt.status = "completed";
  appt.updatedBy = req.userId;
  await appt.save();
  await AppointmentAudit.create({
    appointmentId: appt._id,
    action: "complete",
    byUserId: req.userId,
  });

  res.json({ success: true, appointment: appt });
};

export const markNoShowController = async (req, res) => {
  const { id } = req.params;
  const appt = await Appointment.findById(id);
  if (!appt) return res.status(404).json({ success: false });
  if (appt.status !== "confirmed")
    return res.status(400).json({ success: false });

  appt.status = "no_show";
  appt.updatedBy = req.userId;
  await appt.save();
  await AppointmentAudit.create({
    appointmentId: appt._id,
    action: "noshow",
    byUserId: req.userId,
  });

  res.json({ success: true, appointment: appt });
};
