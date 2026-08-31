import Chat from "../../../common/models/Communication/message.js"; // создашь позже
import Appointment from "../../../common/models/Appointment/appointment.js";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";
import { tReq } from "../../../common/i18n/index.js";

export const openChatForAppointment = async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const userId = req.userId;

    const profile = await ProfileDoctor.findOne({ userId }).lean();
    if (!profile)
      return res
        .status(404)
        .json({ success: false, message: tReq(req, "app.doctor.profileNotFound") });

    const appointment = await Appointment.findById(appointmentId);
    if (!appointment)
      return res
        .status(404)
        .json({ success: false, message: tReq(req, "app.appointment.notFound") });

    if (appointment.type !== "video") {
      return res.status(400).json({
        success: false,
        message: tReq(req, "app.chat.videoAppointmentsOnly"),
      });
    }

    let chat = await Chat.findOne({ appointmentId });
    if (!chat) {
      chat = await Chat.create({
        appointmentId,
        doctorId: appointment.doctorId,
        patientId: appointment.patientId,
      });
    }

    res.json({ success: true, data: chat });
  } catch (err) {
    console.error("❌ Ошибка openChatForAppointment:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};
