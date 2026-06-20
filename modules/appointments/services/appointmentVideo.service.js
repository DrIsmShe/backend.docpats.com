// server/modules/appointments/services/appointmentVideo.service.js
//
// Video-room access for a freelance (out-of-clinic) appointment — a direct
// video consultation between a doctor (User) and a patient.
//
// This is the patient-facing branch: BOTH sides are session users, so both
// get a token from their own session. The doctor is the moderator; the
// patient joins as a regular participant.
//
// Room: `appointment-<appointmentId>`.
//
// Authorization (by session userId from authMiddleware):
//   - userId === appointment.doctorIdUser            → doctor (moderator)
//   - patientPolyclinicId === appointment.patientId  → that appointment's
//        patient (participant). patientPolyclinicId is resolved by
//        authMiddleware from the patient's NewPatientPolyclinic profile.
//   - otherwise                                      → 403
//
// Only for video appointments that are not finished/cancelled.
//
// Self-contained: imports the Appointment model + shared token service; does
// not touch existing appointment controllers (mirrors the other video
// modules).

import Appointment from "../../../common/models/Appointment/appointment.js";
import {
  mintRoomToken,
  isJitsiConfigured,
} from "../../../common/video/jitsiToken.service.js";
import {
  ValidationError,
  ForbiddenError,
  NotFoundError,
} from "../../../common/utils/errors.js";

const TERMINAL = new Set(["cancelled", "completed", "no_show", "refunded"]);

/**
 * Mint a Jitsi token for a freelance appointment video room.
 *
 * @param {object} args
 * @param {string} args.appointmentId
 * @param {string} args.userId               Current session user.
 * @param {string} [args.patientPolyclinicId] Current user's patient profile id
 *                                            (from authMiddleware), if a patient.
 * @param {string} [args.displayName]
 * @returns {Promise<{ token: string, domain: string, room: string, exp: number }>}
 */
export async function issueAppointmentRoomToken({
  appointmentId,
  userId,
  patientPolyclinicId,
  displayName,
}) {
  if (!isJitsiConfigured()) {
    const err = new Error("Video service is not configured");
    err.code = "VIDEO_NOT_CONFIGURED";
    throw err;
  }
  if (!appointmentId) throw new ValidationError("appointmentId is required");
  if (!userId) throw new ForbiddenError("Authentication required");

  const appt = await Appointment.findById(appointmentId)
    .select("doctorIdUser patientId type status")
    .lean();
  if (!appt) throw new NotFoundError("Appointment not found");

  if (appt.type !== "video") {
    throw new ValidationError("This appointment is not a video consultation");
  }
  if (TERMINAL.has(appt.status)) {
    throw new ValidationError("This appointment is closed");
  }

  const isDoctor = String(appt.doctorIdUser) === String(userId);
  const isPatient =
    patientPolyclinicId &&
    String(appt.patientId) === String(patientPolyclinicId);

  if (!isDoctor && !isPatient) {
    throw new ForbiddenError("You are not a participant of this appointment");
  }

  return mintRoomToken({
    room: `appointment-${String(appointmentId)}`,
    userId: String(userId),
    displayName: displayName || null,
    email: null,
    moderator: isDoctor, // doctor hosts; patient joins as participant
  });
}

export default { issueAppointmentRoomToken };
