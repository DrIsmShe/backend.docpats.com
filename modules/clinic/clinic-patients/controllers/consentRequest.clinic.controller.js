// server/modules/clinic/clinic-patients/controllers/consentRequest.clinic.controller.js
//
// Express controllers for CLINIC-SIDE consent request management.
// Sprint 3.2 (Pull Consent, 31 May 2026).
//
// FIXED 31 May 2026 — auth check теперь принимает И User-owner (session.userId
// с активной ClinicMembership), И ClinicEmployee (session.employeeId).
// Делегируем tenantMiddleware который уже разрешает обе ветки.
//
// Endpoints (mounted in modules/clinic/index.js):
//   POST   /api/v1/clinic/patients/:cardId/consent-requests   → createRequest
//   GET    /api/v1/clinic/patients/:cardId/consent-requests   → listRequestsForPatient
//   DELETE /api/v1/clinic/consent-requests/:id                → cancelRequest
//
// ─────────────────────────────────────────────────────────────────────────────
//  PATTERNS
// ─────────────────────────────────────────────────────────────────────────────
//
// • Auth: session + tenantMiddleware applied at parent router.
//   Здесь проверяем что req.tenantContext.clinicId существует — это уже значит
//   что юзер либо имеет membership (User-owner), либо активный employee.
//
// • Audit: written inside service after the request._id is generated.
//
// • Tenant scope: ConsentRequest.clinicId MUST equal req.tenantContext.clinicId.

import mongoose from "mongoose";
import consentRequestService from "../../clinic-consent/services/consentRequest.service.js";
import ClinicPatient from "../models/clinicPatient.model.js";

// ─── Auth + tenant guard ──────────────────────────────────────────────

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
    userId: req.session?.userId || null,
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
  if (!card.linkedUserId) {
    res.status(422).json({
      message:
        "Patient card is not linked to a DocPats user. Link first before requesting consent.",
    });
    return null;
  }
  return card;
}

// ─── POST /clinic/patients/:cardId/consent-requests ───────────────────

export async function createConsentRequest(req, res) {
  const auth = requireClinicActor(req, res);
  if (!auth) return;

  const { cardId } = req.params;
  const { requestedScopes, message } = req.body || {};

  if (!requestedScopes || typeof requestedScopes !== "object") {
    return res.status(400).json({ message: "requestedScopes is required" });
  }
  const anyScope = Object.values(requestedScopes).some(Boolean);
  if (!anyScope) {
    return res
      .status(422)
      .json({ message: "At least one scope must be requested" });
  }
  if (message !== undefined && typeof message !== "string") {
    return res.status(400).json({ message: "message must be a string" });
  }

  try {
    const card = await resolveCard(cardId, auth.clinicId, res);
    if (!card) return;

    const request = await consentRequestService.createRequest({
      payload: {
        patientRef: card._id,
        patientTypeModel: "ClinicPatient",
        patientUserId: card.linkedUserId,
        clinicId: auth.clinicId,
        requestedScopes,
        message: typeof message === "string" ? message.slice(0, 500) : null,
        requestedBy: {
          userId: auth.userId,
          employeeId: auth.employeeId,
        },
      },
      actor: actorFromSession(req),
      context: contextFromReq(req),
    });

    res.status(201).json({ request });
  } catch (err) {
    console.error("[consentRequest.clinic.create]", err);
    if (err.code === "RATE_LIMIT_EXCEEDED") {
      return res.status(429).json({ message: err.message });
    }
    if (err.code === "NO_SCOPES") {
      return res.status(422).json({ message: err.message });
    }
    if (err.name === "ValidationError") {
      return res.status(422).json({ message: err.message });
    }
    res.status(500).json({ message: "Failed to create consent request" });
  }
}

// ─── GET /clinic/patients/:cardId/consent-requests ────────────────────

export async function listConsentRequestsForPatient(req, res) {
  const auth = requireClinicActor(req, res);
  if (!auth) return;

  const { cardId } = req.params;

  try {
    const card = await resolveCard(cardId, auth.clinicId, res);
    if (!card) return;

    const items = await consentRequestService.listByClinicAndPatient(
      auth.clinicId,
      card._id,
      { limit: 100 },
    );
    res.status(200).json({ items, count: items.length });
  } catch (err) {
    console.error("[consentRequest.clinic.list]", err);
    res.status(500).json({ message: "Failed to list consent requests" });
  }
}

// ─── DELETE /clinic/consent-requests/:id ──────────────────────────────

export async function cancelConsentRequest(req, res) {
  const auth = requireClinicActor(req, res);
  if (!auth) return;

  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: "Invalid request id" });
  }

  try {
    const existing = await consentRequestService.findById(id);
    if (!existing) {
      return res.status(404).json({ message: "Consent request not found" });
    }
    if (String(existing.clinicId) !== String(auth.clinicId)) {
      return res.status(403).json({
        message: "Cannot cancel a request that does not belong to your clinic",
      });
    }

    const request = await consentRequestService.cancelRequest({
      requestId: id,
      actor: actorFromSession(req),
      context: contextFromReq(req),
    });
    res.status(200).json({ request, action: "cancelled" });
  } catch (err) {
    console.error("[consentRequest.clinic.cancel]", err);
    if (err.code === "NOT_FOUND") {
      return res.status(404).json({ message: "Consent request not found" });
    }
    if (err.code === "NOT_PENDING") {
      return res.status(409).json({ message: err.message });
    }
    res.status(500).json({ message: "Failed to cancel consent request" });
  }
}

export default {
  createConsentRequest,
  listConsentRequestsForPatient,
  cancelConsentRequest,
};
