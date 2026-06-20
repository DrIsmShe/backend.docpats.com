// server/modules/clinic/clinic-patients/controllers/consent.clinic.controller.js
//
// Express controllers for CLINIC-SIDE management of GRANTED consents
// (PatientConsent). Mirror of consentRequest.clinic.controller.js.
//
// Sprint 3 closure (Pull Consent, part B): клиника может прекратить уже
// выданный ей доступ к пациенту (revoke своего consent).
//
// Endpoints (mounted in modules/clinic/index.js):
//   GET    /api/v1/clinic/patients/:cardId/consents   → listConsentsForPatient
//   DELETE /api/v1/clinic/consents/:id                → revokeClinicConsent
//
// ─────────────────────────────────────────────────────────────────────────────
//  АВТОРИЗАЦИЯ
// ─────────────────────────────────────────────────────────────────────────────
//
// • session + tenantMiddleware применяются на родительском роутере.
// • Клиника видит/отзывает ТОЛЬКО свои consent'ы:
//   consent.clinicId === req.tenantContext.clinicId. Чужой → 403.
// • Для списка дополнительно проверяем, что карта принадлежит этой клинике
//   (resolveCard), и сверяем patientRef === card._id.
//
// ─────────────────────────────────────────────────────────────────────────────
//  ВНИМАНИЕ
// ─────────────────────────────────────────────────────────────────────────────
//
// • revokedBy в модели PatientConsent — ref "User". При отзыве сотрудником
//   клиники (actorType="employee") туда ляжет employeeId. Mongoose ref не
//   валидирует значение, для MVP это приемлемо; в audit log actorType пишется
//   отдельно. Перейти на полиморфный revokedBy — отдельный шаг при желании.

import mongoose from "mongoose";
import consentService from "../../clinic-consent/services/consent.service.js";
import PatientConsent from "../../../../common/models/Polyclinic/PatientConsent.js";
import ClinicPatient from "../models/clinicPatient.model.js";

// ─── Auth + tenant guard (идентично consentRequest.clinic.controller) ──

function requireClinicActor(req, res) {
  const clinicId = req.tenantContext?.clinicId;
  if (!clinicId) {
    res.status(401).json({
      message: "Clinic authentication required",
      code: "NO_CLINIC_CONTEXT",
    });
    return null;
  }
  const employeeId = req.session?.employeeId || null;
  const userId = req.session?.userId || null;
  if (!employeeId && !userId) {
    res.status(401).json({
      message: "Authentication required",
      code: "UNAUTHENTICATED",
    });
    return null;
  }
  return {
    clinicId,
    employeeId,
    userId,
    actorType: employeeId ? "employee" : "user",
  };
}

function actorFromSession(req) {
  return {
    // revokeConsent требует actor.userId — для employee подставляем employeeId,
    // чтобы service не падал на проверке "actor.userId is required".
    userId: req.session?.userId || req.session?.employeeId || null,
    employeeId: req.session?.employeeId || null,
    email:
      req.session?.email ||
      req.session?.userEmail ||
      req.session?.employeeEmail ||
      null,
    role:
      req.session?.role ||
      req.session?.userRole ||
      req.session?.employeeRole ||
      "user",
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

// ─── Helper: resolve ClinicPatient card (must belong to current clinic) ──

async function resolveCard(cardId, clinicId, res) {
  if (!mongoose.isValidObjectId(cardId)) {
    res.status(400).json({ message: "Invalid cardId" });
    return null;
  }
  const card = await ClinicPatient.findOne({
    _id: cardId,
    clinicId,
  }).lean();
  if (!card) {
    res.status(404).json({ message: "Patient card not found in this clinic" });
    return null;
  }
  return card;
}

// ─── Response shape (без лишних полей) ────────────────────────────────

function toShape(doc) {
  if (!doc) return null;
  const scopes = doc.scopes?.toObject?.() || doc.scopes || {};
  const now = new Date();
  const isActive =
    !doc.revokedAt && (!doc.expiresAt || new Date(doc.expiresAt) > now);
  return {
    _id: String(doc._id),
    clinicId: doc.clinicId ? String(doc.clinicId) : null,
    patientRef: doc.patientRef ? String(doc.patientRef) : null,
    purpose: doc.purpose,
    scopes,
    signatureMethod: doc.signatureMethod,
    signedAt: doc.signedAt || null,
    expiresAt: doc.expiresAt || null,
    revokedAt: doc.revokedAt || null,
    revokedReason: doc.revokedReason || null,
    isActive,
    createdAt: doc.createdAt || null,
  };
}

// ─── GET /clinic/patients/:cardId/consents ────────────────────────────
// Все consent'ы, которые этот пациент выдал ЭТОЙ клинике (активные +
// отозванные/истёкшие — для истории). Фильтр по clinicId обязателен.

export async function listConsentsForPatient(req, res) {
  const auth = requireClinicActor(req, res);
  if (!auth) return;

  const { cardId } = req.params;

  try {
    const card = await resolveCard(cardId, auth.clinicId, res);
    if (!card) return;

    const docs = await PatientConsent.find({
      patientRef: card._id,
      clinicId: auth.clinicId,
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const items = docs.map(toShape);
    res.status(200).json({ items, count: items.length });
  } catch (err) {
    console.error("[consent.clinic.list]", err);
    res.status(500).json({ message: "Failed to list consents" });
  }
}

// ─── DELETE /clinic/consents/:id ──────────────────────────────────────
// Клиника прекращает выданный ей доступ. Только свой consent (clinicId match).

export async function revokeClinicConsent(req, res) {
  const auth = requireClinicActor(req, res);
  if (!auth) return;

  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: "Invalid consent id" });
  }

  const { reason } = req.body || {};
  if (reason !== undefined && typeof reason !== "string") {
    return res.status(400).json({ message: "reason must be a string" });
  }

  try {
    // Ownership guard ДО вызова service: consent должен принадлежать клинике.
    const existing = await PatientConsent.findById(id).lean();
    if (!existing) {
      return res.status(404).json({ message: "Consent not found" });
    }
    if (String(existing.clinicId) !== String(auth.clinicId)) {
      return res.status(403).json({
        message: "Cannot revoke a consent that does not belong to your clinic",
      });
    }

    const consent = await consentService.revokeConsent({
      consentId: id,
      reason:
        typeof reason === "string" && reason.trim()
          ? reason.slice(0, 500)
          : "Revoked by clinic",
      actor: actorFromSession(req),
      context: contextFromReq(req),
    });

    res.status(200).json({ consent: toShape(consent), action: "revoked" });
  } catch (err) {
    console.error("[consent.clinic.revoke]", err);
    if (err.code === "NOT_FOUND") {
      return res.status(404).json({ message: "Consent not found" });
    }
    res.status(500).json({ message: "Failed to revoke consent" });
  }
}

export default {
  listConsentsForPatient,
  revokeClinicConsent,
};
