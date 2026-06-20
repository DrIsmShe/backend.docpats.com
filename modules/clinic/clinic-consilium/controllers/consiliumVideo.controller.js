// server/modules/clinic/clinic-consilium/controllers/consiliumVideo.controller.js
//
// Issues a Jitsi token for a consilium video room. Thin layer, same shape as
// the other clinic-* controllers: pull clinicId / userId / membershipId from
// the ALS tenant context, delegate to the service.
//
// displayName is taken from the body (the frontend knows the logged-in
// doctor's name); it is only a label inside the call, never used for auth.

import { asyncHandler } from "../../../../common/middlewares/errorHandler.js";
import {
  getCurrentClinicId,
  getCurrentUserId,
  getCurrentMembershipId,
} from "../../../../common/context/tenantContext.js";
import { issueConsiliumRoomToken } from "../services/consiliumVideo.service.js";

export const issueConsiliumVideoTokenController = asyncHandler(
  async (req, res) => {
    const clinicId = getCurrentClinicId();
    const userId = getCurrentUserId();
    const membershipId = getCurrentMembershipId();

    const rawName =
      typeof req.body?.displayName === "string"
        ? req.body.displayName.trim().slice(0, 80)
        : null;

    try {
      const result = await issueConsiliumRoomToken({
        clinicId,
        consiliumId: req.params.id,
        userId,
        membershipId,
        displayName: rawName || null,
      });
      res.status(200).json(result);
    } catch (err) {
      if (err?.code === "VIDEO_NOT_CONFIGURED") {
        return res
          .status(503)
          .json({ message: "Video service is not configured" });
      }
      throw err; // ValidationError / ForbiddenError / NotFoundError → errorHandler
    }
  },
);

export default { issueConsiliumVideoTokenController };
