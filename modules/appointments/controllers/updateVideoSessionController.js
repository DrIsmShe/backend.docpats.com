import Appointment from "../../../common/models/Appointment/appointment.js";
import { tReq } from "../../../common/i18n/index.js";

export const updateVideoSessionController = async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { startedAt, endedAt, durationSeconds } = req.body;
    const userId = req.userId;

    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: tReq(req, "app.access.unauthorized") });
    }

    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      return res
        .status(404)
        .json({ success: false, message: tReq(req, "app.appointment.notFound") });
    }

    appointment.callSession = {
      startedAt: startedAt
        ? new Date(startedAt)
        : appointment.callSession?.startedAt,
      endedAt: endedAt ? new Date(endedAt) : new Date(),
      durationSeconds: durationSeconds || 0,
      wasVideo: true,
    };

    await appointment.save();

    return res.json({
      success: true,
      message: tReq(req, "app.videoSession.reportSaved"),
      appointment,
    });
  } catch (err) {
    console.error("Ошибка при обновлении видеосессии:", err);
    res.status(500).json({ success: false, message: tReq(req, "app.server.error") });
  }
};
