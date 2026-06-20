// server/modules/clinic/clinic-telemed/services/telemedVideo.service.js
//
// Video-room access for a telemed session (a virtual visit).
//
// Room: `telemed-<joinKey>`. The session carries a unique opaque joinKey
// generated exactly for "the call layer to use as a room id" — we use it so
// the room id is stable and unguessable, and never exposes the raw session
// ObjectId.
//
// Authorization — two sides may join:
//
//   DOCTOR (moderator):
//     - if the session has a hostMembershipId, ONLY that host;
//     - if it has none, any clinic member who reached here (RBAC + tenant
//       scope already applied).
//
//   PATIENT (participant, NOT moderator):
//     - the registered DocPats user linked to this session, identified by
//       EITHER session.patientUserId === userId
//       OR    the session's ClinicPatient.linkedUserId === userId.
//     A patient WITHOUT a linked account cannot be admitted (no session to
//       authorize) — that would need a guest link, deferred.
//
// No live token on a terminal session (completed/cancelled/no_show).
//
// Self-contained: imports the telemed + ClinicPatient models + shared token
// service; does NOT touch telemed.service.js.

import TelemedSession from "../models/telemedSession.model.js";
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

const TERMINAL = new Set(["completed", "cancelled", "no_show"]);

/**
 * Is the current user the patient of this telemed session?
 * Checks the direct patientUserId link first, then the linked ClinicPatient.
 */
async function isSessionPatient(session, userId) {
  if (!userId) return false;

  // Direct link on the session.
  if (
    session.patientUserId &&
    String(session.patientUserId) === String(userId)
  ) {
    return true;
  }

  // Indirect link via the ClinicPatient profile.
  if (session.patientId) {
    // skipTenantScope: the patient is querying across the tenant boundary
    // (they are not a clinic member), but we only look up the exact
    // ClinicPatient already referenced by this clinic's session.
    const cp = await ClinicPatient.findOne({ _id: session.patientId })
      .select("linkedUserId")
      .setOptions({ skipTenantScope: true })
      .lean();
    if (cp?.linkedUserId && String(cp.linkedUserId) === String(userId)) {
      return true;
    }
  }

  return false;
}

/**
 * Mint a Jitsi token for a telemed session video room.
 *
 * @param {object} args
 * @param {string} args.clinicId        Tenant of the session.
 * @param {string} args.sessionId       Telemed session being joined.
 * @param {string} args.userId          Current user — goes into the token.
 * @param {string} [args.membershipId]  Current membership (doctor side), if any.
 * @param {string} [args.displayName]   Label shown in the call.
 * @returns {Promise<{ token: string, domain: string, room: string, exp: number }>}
 */
export async function issueTelemedRoomToken({
  clinicId,
  sessionId,
  userId,
  membershipId,
  displayName,
}) {
  if (!isJitsiConfigured()) {
    const err = new Error("Video service is not configured");
    err.code = "VIDEO_NOT_CONFIGURED";
    throw err;
  }
  if (!clinicId) throw new ValidationError("clinicId is required");
  if (!sessionId) throw new ValidationError("sessionId is required");
  if (!userId) throw new ForbiddenError("Authentication required");

  // Session must exist in THIS clinic.
  const session = await TelemedSession.findOne({ _id: sessionId, clinicId })
    .select("status joinKey hostMembershipId patientUserId patientId")
    .lean();
  if (!session) throw new NotFoundError("Telemed session not found");

  // No live call on a finished/cancelled session.
  if (TERMINAL.has(session.status)) {
    throw new ValidationError(
      "Cannot start a call on a closed telemed session",
    );
  }

  // ─── DOCTOR side ───
  // A clinic membership is present → treat as the clinician side.
  let isDoctor = false;
  if (membershipId) {
    if (session.hostMembershipId) {
      isDoctor = String(session.hostMembershipId) === String(membershipId);
      // host set but this membership is not the host → fall through to
      // patient check (a non-host member is not auto-allowed)
    } else {
      // no host set → any clinic member who reached here is allowed
      isDoctor = true;
    }
  }

  if (isDoctor) {
    return mintRoomToken({
      room: `telemed-${session.joinKey}`,
      userId: String(userId),
      displayName: displayName || null,
      email: null,
      moderator: true, // doctor side is moderator
    });
  }

  // ─── PATIENT side ───
  const patientOk = await isSessionPatient(session, userId);
  if (patientOk) {
    return mintRoomToken({
      room: `telemed-${session.joinKey}`,
      userId: String(userId),
      displayName: displayName || null,
      email: null,
      moderator: false, // patient joins as a participant
    });
  }

  throw new ForbiddenError("You are not a participant of this telemed session");
}

export default { issueTelemedRoomToken };
