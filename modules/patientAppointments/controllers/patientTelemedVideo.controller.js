// server/modules/patientAppointments/controllers/patientTelemedVideo.controller.js
//
// Patient-side entry to a clinic telemed session video room.
//
// The clinic telemed endpoint (/api/v1/clinic/telemed/:id/video-token) runs
// under the clinic tenantMiddleware and needs a clinic membership — a patient
// is NOT a clinic member, so they cannot use it. This controller is the
// patient's door: it authenticates by session (authMiddleware sets req.userId),
// resolves the session's clinicId itself, and delegates to the SAME telemed
// video service with membershipId = null, which routes to the patient branch
// (patientUserId OR the session's ClinicPatient.linkedUserId).

import TelemedSession from "../../clinic/clinic-telemed/models/telemedSession.model.js";
import { issueTelemedRoomToken } from "../../clinic/clinic-telemed/services/telemedVideo.service.js";

export const issuePatientTelemedVideoTokenController = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Неавторизованный доступ" });
    }

    const sessionId = req.params.sessionId;
    if (!sessionId) {
      return res
        .status(400)
        .json({ success: false, message: "sessionId required" });
    }

    // Resolve the session's clinic WITHOUT a tenant context (the patient is
    // not a clinic member). We only read clinicId here; the service re-checks
    // membership/patient access.
    const session = await TelemedSession.findOne({ _id: sessionId })
      .select("clinicId")
      .setOptions({ skipTenantScope: true })
      .lean();
    if (!session) {
      return res
        .status(404)
        .json({ success: false, message: "Telemed session not found" });
    }

    const rawName =
      typeof req.body?.displayName === "string"
        ? req.body.displayName.trim().slice(0, 80)
        : null;

    const result = await issueTelemedRoomToken({
      clinicId: session.clinicId,
      sessionId,
      userId,
      membershipId: null, // patient is not a clinic member → patient branch
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

export default { issuePatientTelemedVideoTokenController };
