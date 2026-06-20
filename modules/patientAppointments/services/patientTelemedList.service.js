// server/modules/patientAppointments/services/patientTelemedList.service.js
//
// Lists the telemed sessions a patient may attend. The patient is a session
// participant if EITHER:
//   - session.patientUserId === userId, OR
//   - session.patientId → ClinicPatient.linkedUserId === userId.
//
// Returns lightweight cards: id, title, scheduledAt, durationMinutes, status,
// clinicName, doctorName. Names are resolved via lookups (membership→user,
// clinic). Doctor/patient identity in User is encrypted — we decrypt the
// doctor's first/last name for display.
//
// All queries bypass tenant scope (the patient is not a clinic member); we
// only ever read rows already tied to this patient.

import TelemedSession from "../../clinic/clinic-telemed/models/telemedSession.model.js";
import ClinicPatient from "../../clinic/clinic-patients/models/clinicPatient.model.js";
import ClinicMembership from "../../clinic/clinic-staff/models/clinicMembership.model.js";
import Clinic from "../../clinic/clinic-core/models/clinic.model.js";
import User, { decrypt } from "../../../common/models/Auth/users.js";

/**
 * @param {object} args
 * @param {string} args.userId  Current patient (session user).
 * @returns {Promise<Array>} session cards
 */
export async function listPatientTelemedSessions({ userId }) {
  if (!userId) return [];

  // ClinicPatient profiles linked to this user (indirect link path).
  const linkedPatients = await ClinicPatient.find({ linkedUserId: userId })
    .select("_id")
    .setOptions({ skipTenantScope: true })
    .lean();
  const linkedPatientIds = linkedPatients.map((p) => p._id);

  // Sessions where the patient is directly linked OR via a linked ClinicPatient.
  const sessions = await TelemedSession.find({
    $or: [
      { patientUserId: userId },
      ...(linkedPatientIds.length
        ? [{ patientId: { $in: linkedPatientIds } }]
        : []),
    ],
  })
    .select(
      "title scheduledAt durationMinutes status clinicId hostMembershipId",
    )
    .sort({ scheduledAt: -1 })
    .setOptions({ skipTenantScope: true })
    .lean();

  if (!sessions.length) return [];

  // Resolve clinic names.
  const clinicIds = [
    ...new Set(sessions.map((s) => String(s.clinicId)).filter(Boolean)),
  ];
  const clinics = await Clinic.find({ _id: { $in: clinicIds } })
    .select("name")
    .lean();
  const clinicNameById = new Map(clinics.map((c) => [String(c._id), c.name]));

  // Resolve doctor (host) names via membership → user.
  const membershipIds = [
    ...new Set(sessions.map((s) => String(s.hostMembershipId)).filter(Boolean)),
  ];
  const memberships = membershipIds.length
    ? await ClinicMembership.find({ _id: { $in: membershipIds } })
        .select("userId")
        .lean()
    : [];
  const userIdByMembership = new Map(
    memberships.map((m) => [String(m._id), String(m.userId)]),
  );

  const doctorUserIds = [
    ...new Set([...userIdByMembership.values()].filter(Boolean)),
  ];
  const doctors = doctorUserIds.length
    ? await User.find({ _id: { $in: doctorUserIds } })
        .select("firstNameEncrypted lastNameEncrypted")
        .lean()
    : [];
  const doctorNameById = new Map(
    doctors.map((u) => {
      const first = u.firstNameEncrypted ? decrypt(u.firstNameEncrypted) : "";
      const last = u.lastNameEncrypted ? decrypt(u.lastNameEncrypted) : "";
      return [String(u._id), `${first || ""} ${last || ""}`.trim()];
    }),
  );

  return sessions.map((s) => {
    const docUserId = s.hostMembershipId
      ? userIdByMembership.get(String(s.hostMembershipId))
      : null;
    return {
      _id: String(s._id),
      title: s.title,
      scheduledAt: s.scheduledAt,
      durationMinutes: s.durationMinutes,
      status: s.status,
      clinicName: clinicNameById.get(String(s.clinicId)) || null,
      doctorName: (docUserId && doctorNameById.get(docUserId)) || null,
    };
  });
}

export default { listPatientTelemedSessions };
