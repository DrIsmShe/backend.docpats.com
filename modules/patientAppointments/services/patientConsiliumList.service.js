// server/modules/patientAppointments/services/patientConsiliumList.service.js
//
// Patient-side list of consilia they may join.
//
// A consilium is doctor-private by default. A patient sees a consilium here
// ONLY when a doctor has invited them (patientCanJoin === true) AND the
// consilium concerns them (patientId -> one of their ClinicPatient cards).
// This is the read-side mirror of the patientCanJoin gate in the video
// service — the patient never learns a consilium exists until invited.
//
// Cross-tenant by nature (resolved from the user's ClinicPatient cards across
// every clinic), so every query runs with skipTenantScope. All lookups are
// batched to avoid N+1.
//
// Cross-module models (ClinicPatient / Consilium / ClinicMembership / Clinic /
// User) are pulled from the mongoose registry instead of by relative path —
// the model names are fixed by the `ref`s in consilium.model.js, and every
// model is registered at server boot, so this avoids brittle ../../ imports
// (ClinicMembership in particular lives in clinic-staff, not clinic-core).
// `decrypt` is a function (not a model), so it stays a path import — already
// used across the patient side at common/models/Auth/users.js.

import mongoose from "mongoose";
import { decrypt } from "../../../common/models/Auth/users.js";

function safeDecrypt(v) {
  try {
    return decrypt(v) || "";
  } catch {
    return "";
  }
}

/**
 * @param {string} userId  Session user (patient).
 * @returns {Promise<Array<{
 *   id: string, title: string, status: string, when: Date,
 *   doctorName: string|null, clinicName: string|null,
 *   messageCount: number, joinSource: "consilium-patient", joinable: boolean
 * }>>}
 */
export async function getMyJoinableConsilia(userId) {
  if (!userId) return [];

  const ClinicPatient = mongoose.model("ClinicPatient");
  const Consilium = mongoose.model("Consilium");
  const ClinicMembership = mongoose.model("ClinicMembership");
  const Clinic = mongoose.model("Clinic");
  const User = mongoose.model("User");

  // 1) Which ClinicPatient cards belong to this user (any clinic)?
  const cards = await ClinicPatient.find({ linkedUserId: userId })
    .setOptions({ skipTenantScope: true })
    .select("_id")
    .lean();
  if (!cards.length) return [];
  const cardIds = cards.map((c) => c._id);

  // 2) Consilia about those cards that the patient has been invited into.
  const consilia = await Consilium.find({
    patientId: { $in: cardIds },
    patientCanJoin: true,
    status: { $ne: "archived" },
  })
    .setOptions({ skipTenantScope: true })
    .select(
      "title status updatedAt messageCount clinicId initiatorMembershipId",
    )
    .sort({ updatedAt: -1 })
    .lean();
  if (!consilia.length) return [];

  // 3) Batch-resolve initiator membership -> userId -> User name.
  const membershipIds = [
    ...new Set(
      consilia
        .map((c) => c.initiatorMembershipId)
        .filter(Boolean)
        .map(String),
    ),
  ];
  const memberships = membershipIds.length
    ? await ClinicMembership.find({ _id: { $in: membershipIds } })
        .setOptions({ skipTenantScope: true })
        .select("userId")
        .lean()
    : [];
  const membershipToUserId = new Map(
    memberships.map((m) => [String(m._id), m.userId ? String(m.userId) : null]),
  );

  const doctorUserIds = [
    ...new Set([...membershipToUserId.values()].filter(Boolean)),
  ];
  const doctors = doctorUserIds.length
    ? await User.find({ _id: { $in: doctorUserIds } })
        .select("firstNameEncrypted lastNameEncrypted")
        .lean()
    : [];
  const userIdToName = new Map(
    doctors.map((u) => {
      const name = `${safeDecrypt(u.firstNameEncrypted)} ${safeDecrypt(
        u.lastNameEncrypted,
      )}`.trim();
      return [String(u._id), name || null];
    }),
  );

  // 4) Batch-resolve clinic names.
  const clinicIds = [
    ...new Set(
      consilia
        .map((c) => c.clinicId)
        .filter(Boolean)
        .map(String),
    ),
  ];
  const clinics = clinicIds.length
    ? await Clinic.find({ _id: { $in: clinicIds } })
        .setOptions({ skipTenantScope: true })
        .select("name")
        .lean()
    : [];
  const clinicIdToName = new Map(
    clinics.map((cl) => [String(cl._id), cl.name || null]),
  );

  // 5) Shape for the patient UI.
  return consilia.map((c) => {
    const docUserId = c.initiatorMembershipId
      ? membershipToUserId.get(String(c.initiatorMembershipId))
      : null;
    return {
      id: String(c._id),
      title: c.title || null,
      status: c.status,
      when: c.updatedAt,
      doctorName: docUserId ? userIdToName.get(docUserId) || null : null,
      clinicName: c.clinicId
        ? clinicIdToName.get(String(c.clinicId)) || null
        : null,
      messageCount: c.messageCount || 0,
      joinSource: "consilium-patient",
      joinable: true, // already filtered to invited, non-archived
    };
  });
}

export default { getMyJoinableConsilia };
