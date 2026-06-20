// server/modules/appointments/controllers/appointmentVideo.controller.js
//
// Issues a Jitsi token for a freelance appointment video room.
//
// Uses the same session auth as the rest of this module: authMiddleware sets
// req.userId and req.user (including patientPolyclinicId for patients). Both
// doctor and patient call this from their own session.
//
// displayName comes from the body (the frontend knows the logged-in name);
// it is only a label inside the call, never used for auth.

import { issueAppointmentRoomToken } from "../services/appointmentVideo.service.js";

export const issueAppointmentVideoTokenController = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Неавторизованный доступ" });
    }

    const rawName =
      typeof req.body?.displayName === "string"
        ? req.body.displayName.trim().slice(0, 80)
        : null;

    const result = await issueAppointmentRoomToken({
      appointmentId: req.params.appointmentId,
      userId,
      patientPolyclinicId: req.user?.patientPolyclinicId || null,
      displayName: rawName || null,
    });

    return res.status(200).json(result);
  } catch (err) {
    if (err?.code === "VIDEO_NOT_CONFIGURED") {
      return res
        .status(503)
        .json({ success: false, message: "Video service is not configured" });
    }
    const status =
      err?.name === "ForbiddenError"
        ? 403
        : err?.name === "NotFoundError"
          ? 404
          : err?.name === "ValidationError"
            ? 400
            : 500;
    return res
      .status(status)
      .json({ success: false, message: err?.message || "Ошибка сервера" });
  }
};

export default { issueAppointmentVideoTokenController };
