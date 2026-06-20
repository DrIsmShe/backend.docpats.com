// server/modules/patientAppointments/services/appointmentVideo.service.js
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
//   - patient (participant) when EITHER:
//       • appointment.patientId === userId           (patientId stores the
//         patient's User._id directly), OR
//       • appointment.patientId === patientPolyclinicId
//         (patientId stores the NewPatientPolyclinic profile id; the profile
//         id is resolved by authMiddleware from the patient's profile)
//   - otherwise                                      → 403
//
// Only for video appointments that are not finished/cancelled.
//
// Lives in patientAppointments (a mounted module). The legacy modules/
// appointments folder is NOT wired into the app, so the token route lives
// here, where the real appointment flow runs. Uses the shared Appointment
// model + the shared Jitsi token service.

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
 * @param {string} args.userId                Current session user.
 * @param {string} [args.patientPolyclinicId] Current user's patient profile id
 *                                             (from authMiddleware), if a patient.
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

  const apptPatient = appt.patientId ? String(appt.patientId) : null;

  const isDoctor = String(appt.doctorIdUser) === String(userId);
  const isPatient =
    !!apptPatient &&
    (apptPatient === String(userId) ||
      (patientPolyclinicId && apptPatient === String(patientPolyclinicId)));

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
