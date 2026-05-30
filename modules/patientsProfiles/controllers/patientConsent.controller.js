// server/modules/patientsProfiles/controllers/patientConsent.controller.js
//
// Express controllers for patient-cabinet consent management.
// Sprint 3.1 (PatientConsent UI MVP, 30 May 2026).
//
// Hardcoded per Sprint 3.1 MVP decision:
//   purpose = "treatment", signatureMethod = "electronic"

import myClinicsService, {
  listMyClinics,
  findMyCard,
  findMyConsent,
} from "../services/myClinics.service.js";
import consentService from "../../clinic/clinic-consent/services/consent.service.js";

// ─── Auth guard ──────────────────────────────────────────────────────

function requirePatient(req, res) {
  if (!req.session?.userId) {
    res
      .status(401)
      .json({ authenticated: false, message: "Not authenticated" });
    return null;
  }
  if (req.session.role !== "patient") {
    res.status(403).json({ message: "Patient role required" });
    return null;
  }
  return req.session.userId;
}

function actorFromSession(req) {
  return {
    userId: req.session.userId,
    email: req.session.email || null,
    role: req.session.role || "patient",
  };
}

function contextFromReq(req) {
  return {
    ipAddress: req.ip || req.headers["x-forwarded-for"] || null,
    userAgent: req.headers["user-agent"] || null,
    sessionId: req.sessionID || null,
    requestId: req.id || null,
    httpMethod: req.method,
    httpPath: req.originalUrl,
  };
}

// ─── GET /patient-profile/my-clinics ─────────────────────────────────

export async function getMyClinics(req, res) {
  const userId = requirePatient(req, res);
  if (!userId) return;

  try {
    const items = await listMyClinics({ userId });
    res.status(200).json({ items, count: items.length });
  } catch (err) {
    console.error("[patientConsent.getMyClinics]", err);
    res.status(500).json({ message: "Failed to load clinics" });
  }
}

// ─── POST /patient-profile/grant-consent ─────────────────────────────

export async function grantConsent(req, res) {
  const userId = requirePatient(req, res);
  if (!userId) return;

  const { cardId, scopes } = req.body || {};

  if (!cardId) {
    return res.status(400).json({ message: "cardId is required" });
  }
  if (!scopes || typeof scopes !== "object") {
    return res.status(400).json({ message: "scopes object is required" });
  }
  const hasAnyScope = Object.values(scopes).some(Boolean);
  if (!hasAnyScope) {
    return res
      .status(400)
      .json({ message: "At least one scope must be enabled" });
  }

  try {
    const card = await findMyCard({ userId, cardId });
    if (!card) {
      return res.status(404).json({ message: "Patient card not found" });
    }

    // If active consent exists — update scopes instead of duplicate.
    const existing = await consentService.getActiveConsent(
      card._id,
      card.clinicId,
    );
    if (existing) {
      const updated = await consentService.updateScopes({
        consentId: existing._id,
        scopes,
        actor: actorFromSession(req),
        context: contextFromReq(req),
      });
      return res.status(200).json({
        consent: updated,
        action: "updated_existing",
      });
    }

    const consent = await consentService.grantConsent({
      payload: {
        patientRef: card._id,
        patientTypeModel: "ClinicPatient",
        patientUserId: userId,
        clinicId: card.clinicId,
        purpose: "treatment",
        scopes,
        signedAt: new Date(),
        signedByPatient: userId,
        signatureMethod: "electronic",
      },
      actor: actorFromSession(req),
      context: contextFromReq(req),
    });

    res.status(201).json({ consent, action: "granted" });
  } catch (err) {
    console.error("[patientConsent.grantConsent]", err);
    if (err.name === "ValidationError") {
      return res.status(422).json({ message: err.message });
    }
    res.status(500).json({ message: "Failed to grant consent" });
  }
}

// ─── PATCH /patient-profile/update-consent-scopes/:id ────────────────

export async function updateConsentScopes(req, res) {
  const userId = requirePatient(req, res);
  if (!userId) return;

  const consentId = req.params.id;
  const { scopes } = req.body || {};

  if (!consentId) {
    return res.status(400).json({ message: "Consent id is required" });
  }
  if (!scopes || typeof scopes !== "object") {
    return res.status(400).json({ message: "scopes object is required" });
  }

  try {
    const owned = await findMyConsent({ userId, consentId });
    if (!owned) {
      return res.status(404).json({ message: "Consent not found" });
    }

    const updated = await consentService.updateScopes({
      consentId,
      scopes,
      actor: actorFromSession(req),
      context: contextFromReq(req),
    });
    res.status(200).json({ consent: updated });
  } catch (err) {
    console.error("[patientConsent.updateConsentScopes]", err);
    if (err.code === "INACTIVE_CONSENT") {
      return res.status(409).json({
        message:
          "Cannot update revoked or expired consent. Please grant a new one.",
      });
    }
    if (err.code === "NOT_FOUND") {
      return res.status(404).json({ message: "Consent not found" });
    }
    res.status(500).json({ message: "Failed to update consent" });
  }
}

// ─── DELETE /patient-profile/revoke-consent/:id ──────────────────────

export async function revokeConsent(req, res) {
  const userId = requirePatient(req, res);
  if (!userId) return;

  const consentId = req.params.id;
  const { reason } = req.body || {};

  if (!consentId) {
    return res.status(400).json({ message: "Consent id is required" });
  }

  try {
    const owned = await findMyConsent({ userId, consentId });
    if (!owned) {
      return res.status(404).json({ message: "Consent not found" });
    }

    const revoked = await consentService.revokeConsent({
      consentId,
      reason: typeof reason === "string" ? reason.slice(0, 500) : null,
      actor: actorFromSession(req),
      context: contextFromReq(req),
    });
    res.status(200).json({ consent: revoked });
  } catch (err) {
    console.error("[patientConsent.revokeConsent]", err);
    if (err.code === "NOT_FOUND") {
      return res.status(404).json({ message: "Consent not found" });
    }
    res.status(500).json({ message: "Failed to revoke consent" });
  }
}

export default {
  getMyClinics,
  grantConsent,
  updateConsentScopes,
  revokeConsent,
};
