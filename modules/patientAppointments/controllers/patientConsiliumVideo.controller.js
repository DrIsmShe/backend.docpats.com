// server/modules/patientAppointments/controllers/patientConsiliumVideo.controller.js
//
// Patient-side entry to a clinic consilium video room.
//
// The clinic consilium endpoint (/api/v1/clinic/consilia/:id/video-token) runs
// under the clinic tenantMiddleware and needs a clinic membership — a patient
// is NOT a clinic member, so they cannot use it. This controller is the
// patient's door: it authenticates by session (authMiddleware sets req.userId),
// resolves the consilium's clinicId itself, and delegates to the SAME consilium
// video service with membershipId = null, which routes to the patient branch
// (patientId -> ClinicPatient.linkedUserId AND consilium.patientCanJoin).

import Consilium from "../../clinic/clinic-consilium/models/consilium.model.js";
import { issueConsiliumRoomToken } from "../../clinic/clinic-consilium/services/consiliumVideo.service.js";

export const issuePatientConsiliumVideoTokenController = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Неавторизованный доступ" });
    }

    const consiliumId = req.params.consiliumId;
    if (!consiliumId) {
      return res
        .status(400)
        .json({ success: false, message: "consiliumId required" });
    }

    // Resolve the consilium's clinic WITHOUT a tenant context (the patient is
    // not a clinic member). We only read clinicId here; the service re-checks
    // patient ownership + the patientCanJoin invite.
    const consilium = await Consilium.findOne({ _id: consiliumId })
      .select("clinicId")
      .setOptions({ skipTenantScope: true })
      .lean();
    if (!consilium) {
      return res
        .status(404)
        .json({ success: false, message: "Consilium not found" });
    }

    const rawName =
      typeof req.body?.displayName === "string"
        ? req.body.displayName.trim().slice(0, 80)
        : null;

    const result = await issueConsiliumRoomToken({
      clinicId: consilium.clinicId,
      consiliumId,
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

export default { issuePatientConsiliumVideoTokenController };
