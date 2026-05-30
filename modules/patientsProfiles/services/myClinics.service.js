// server/modules/patientsProfiles/services/myClinics.service.js
//
// Patient cabinet "Мои клиники" — list service.
//
// Returns clinics where the authenticated patient has a card (ClinicPatient),
// plus the current active PatientConsent for each (if any).
//
// Sprint 3.1 (PatientConsent UI MVP, 30 May 2026).

import mongoose from "mongoose";
import ClinicPatient from "../../clinic/clinic-patients/models/clinicPatient.model.js";
import PatientConsent from "../../../common/models/Polyclinic/PatientConsent.js";
import Clinic from "../../clinic/clinic-core/models/clinic.model.js";

/**
 * List clinics where the patient has a card + their consent status.
 */
export async function listMyClinics({ userId }) {
  if (!userId) {
    throw new Error("listMyClinics: userId is required");
  }

  const userObjectId =
    typeof userId === "string" ? new mongoose.Types.ObjectId(userId) : userId;

  // 1. All ClinicPatient cards linked to this user, across all clinics.
  //    Bypass tenantScopedPlugin — patient-side request has no clinicId context.
  const cards = await ClinicPatient.find({
    linkedUserId: userObjectId,
    isDeleted: { $ne: true },
  })
    .setOptions({ skipTenantScope: true })
    .select("_id clinicId createdAt")
    .lean();

  if (cards.length === 0) {
    return [];
  }

  // 2. Load Clinic docs for all referenced clinics in one query.
  const clinicIds = cards.map((c) => c.clinicId).filter(Boolean);
  const clinics = await Clinic.find({ _id: { $in: clinicIds } })
    .select("_id name slug address city country logo timezone")
    .lean();
  const clinicById = new Map(clinics.map((c) => [String(c._id), c]));

  // 3. For each card, fetch the current active consent.
  const items = await Promise.all(
    cards.map(async (card) => {
      const clinic = clinicById.get(String(card.clinicId)) || null;
      const consentDoc = await PatientConsent.findActive(
        card._id,
        card.clinicId,
      );

      return {
        clinic: clinic
          ? {
              _id: String(clinic._id),
              name: clinic.name,
              slug: clinic.slug,
              address: clinic.address || null,
              city: clinic.city || null,
              country: clinic.country || null,
              logo: clinic.logo || null,
              timezone: clinic.timezone || null,
            }
          : null,
        card: {
          _id: String(card._id),
          createdAt: card.createdAt,
        },
        consent: consentDoc
          ? {
              _id: String(consentDoc._id),
              scopes: consentDoc.scopes?.toObject?.() || consentDoc.scopes,
              signedAt: consentDoc.signedAt,
              expiresAt: consentDoc.expiresAt,
              purpose: consentDoc.purpose,
              signatureMethod: consentDoc.signatureMethod,
            }
          : null,
      };
    }),
  );

  // 4. Sort by most-recently-created card first.
  items.sort(
    (a, b) =>
      new Date(b.card.createdAt).getTime() -
      new Date(a.card.createdAt).getTime(),
  );

  return items;
}

/**
 * Verify ownership of a ClinicPatient card by this user.
 */
export async function findMyCard({ userId, cardId }) {
  if (!userId || !cardId) return null;

  const userObjectId =
    typeof userId === "string" ? new mongoose.Types.ObjectId(userId) : userId;
  const cardObjectId =
    typeof cardId === "string" ? new mongoose.Types.ObjectId(cardId) : cardId;

  const card = await ClinicPatient.findOne({
    _id: cardObjectId,
    linkedUserId: userObjectId,
    isDeleted: { $ne: true },
  })
    .setOptions({ skipTenantScope: true })
    .lean();

  return card || null;
}

/**
 * Verify ownership of a consent document by this user.
 */
export async function findMyConsent({ userId, consentId }) {
  if (!userId || !consentId) return null;

  const userObjectId =
    typeof userId === "string" ? new mongoose.Types.ObjectId(userId) : userId;

  const consent = await PatientConsent.findById(consentId);
  if (!consent) return null;

  if (consent.patientUserId) {
    return String(consent.patientUserId) === String(userObjectId)
      ? consent
      : null;
  }

  // Fallback: check via patient card
  const card = await ClinicPatient.findOne({
    _id: consent.patientRef,
    linkedUserId: userObjectId,
  })
    .setOptions({ skipTenantScope: true })
    .lean();

  return card ? consent : null;
}

export default {
  listMyClinics,
  findMyCard,
  findMyConsent,
};
