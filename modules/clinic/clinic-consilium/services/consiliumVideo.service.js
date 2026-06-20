// server/modules/clinic/clinic-consilium/services/consiliumVideo.service.js
//
// Video-room access for a consilium (group call: several doctors and,
// optionally, the patient the consilium concerns).
//
// ONE service, two entry paths:
//
//   DOCTOR path  (membershipId provided — from the clinic tenantMiddleware):
//     admitted iff the membership is the initiator or a listed participant.
//     Doctor = Jitsi moderator.
//
//   PATIENT path (membershipId === null — from the patient session endpoint):
//     admitted iff BOTH:
//       (a) the consilium's patientId -> ClinicPatient.linkedUserId is the
//           session user, AND
//       (b) a doctor has explicitly opened the room: consilium.patientCanJoin.
//     Patient = guest (moderator:false).
//
// Gate C rationale: a consilium is doctor-private by default. Doctors
// deliberate first; the patient is only let into the live room when invited
// (patientCanJoin), so candid clinical discussion is never silently exposed.
//
// The patient never has a clinic tenant context, so the ClinicPatient lookup
// runs with skipTenantScope — the same bridge the patient telemed branch uses.
//
// Self-contained: imports the consilium + clinic-patient models and the shared
// token service; it does NOT touch consilium.service.js.

import Consilium from "../models/consilium.model.js";
import ClinicPatient from "../../clinic-patients/models/clinicPatient.model.js";
import {
  mintRoomToken,
  isJitsiConfigured,
} from "../../../../common/video/jitsiToken.service.js";
import {
  ValidationError,
  ForbiddenError,
  NotFoundError,
} from "../../../../common/utils/errors.js";

/** Doctor membership is the initiator or a listed participant. */
function isConsiliumParticipant(consilium, membershipId) {
  if (!membershipId) return false;
  const mid = String(membershipId);

  if (
    consilium.initiatorMembershipId &&
    String(consilium.initiatorMembershipId) === mid
  ) {
    return true;
  }
  const list = consilium.participantMembershipIds || [];
  return list.some((id) => String(id) === mid);
}

/** Patient session-user owns this consilium via the ClinicPatient bridge. */
async function patientOwnsConsilium(consilium, userId) {
  if (!consilium.patientId) return false;
  const card = await ClinicPatient.findById(consilium.patientId)
    .setOptions({ skipTenantScope: true })
    .select("linkedUserId")
    .lean();
  if (!card) return false;
  return String(card.linkedUserId || "") === String(userId);
}

/**
 * Mint a Jitsi token for a consilium video room.
 *
 * @param {object} args
 * @param {string} args.clinicId       Tenant the consilium belongs to.
 * @param {string} args.consiliumId    Consilium being joined.
 * @param {string} args.userId         Current user — goes into the token.
 * @param {string|null} [args.membershipId] Clinic membership for the DOCTOR
 *        path; pass null for the PATIENT path.
 * @param {string} [args.displayName]  Label shown in the call.
 * @returns {Promise<{ token: string, domain: string, room: string, exp: number }>}
 */
export async function issueConsiliumRoomToken({
  clinicId,
  consiliumId,
  userId,
  membershipId,
  displayName,
}) {
  if (!isJitsiConfigured()) {
    // Surfaced as 503 by the controller.
    const err = new Error("Video service is not configured");
    err.code = "VIDEO_NOT_CONFIGURED";
    throw err;
  }
  if (!clinicId) throw new ValidationError("clinicId is required");
  if (!consiliumId) throw new ValidationError("consiliumId is required");
  if (!userId) throw new ForbiddenError("Authentication required");

  // Consilium must exist in THIS clinic.
  const consilium = await Consilium.findOne({ _id: consiliumId, clinicId })
    .select(
      "status patientId patientCanJoin initiatorMembershipId participantMembershipIds",
    )
    .lean();
  if (!consilium) throw new NotFoundError("Consilium not found");

  // No live calls on an archived (soft-deleted) consilium — for anyone.
  if (consilium.status === "archived") {
    throw new ValidationError("Cannot start a call on an archived consilium");
  }

  const isDoctor = Boolean(membershipId);

  if (isDoctor) {
    // STRICT: only the consilium's own participants/initiator may join.
    if (!isConsiliumParticipant(consilium, membershipId)) {
      throw new ForbiddenError("You are not a participant of this consilium");
    }
  } else {
    // PATIENT path: must be the consilium's own patient AND explicitly invited.
    const owns = await patientOwnsConsilium(consilium, userId);
    if (!owns) {
      throw new ForbiddenError("This consilium does not concern you");
    }
    if (!consilium.patientCanJoin) {
      throw new ForbiddenError(
        "You have not been invited to this consilium's video room",
      );
    }
  }

  return mintRoomToken({
    room: `consilium-${String(consiliumId)}`,
    userId: String(userId),
    displayName: displayName || null,
    email: null,
    moderator: isDoctor, // doctors moderate; the patient joins as a guest
  });
}

export default { issueConsiliumRoomToken };
