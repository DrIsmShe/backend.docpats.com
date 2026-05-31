// server/modules/patientsProfiles/controllers/consentRequest.controller.js
//
// Express controllers for patient-cabinet consent REQUEST management.
// Sprint 3.2 (Pull Consent, 31 May 2026).
//
// Endpoints:
//   GET    /patient-profile/consent-requests              → listPending
//   POST   /patient-profile/consent-requests/:id/approve  → approve (+ create PatientConsent)
//   POST   /patient-profile/consent-requests/:id/reject   → reject
//
// Mirrors Sprint 3.1 patientConsent.controller.js conventions:
//   • requirePatient auth guard
//   • actorFromSession + contextFromReq helpers
//   • Service errors mapped to HTTP via err.code
//   • All audit писется внутри service

import consentRequestService from "../../clinic/clinic-consent/services/consentRequest.service.js";

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

// ─── GET /patient-profile/consent-requests ───────────────────────────
// Список всех PENDING запросов на текущего пациента.

export async function listMyPendingRequests(req, res) {
  const userId = requirePatient(req, res);
  if (!userId) return;

  try {
    const items = await consentRequestService.listPendingForPatient(userId, {
      limit: 50,
    });
    res.status(200).json({ items, count: items.length });
  } catch (err) {
    console.error("[consentRequest.listMyPendingRequests]", err);
    res.status(500).json({ message: "Failed to load consent requests" });
  }
}

// ─── POST /patient-profile/consent-requests/:id/approve ──────────────
// Body (optional): { approvedScopes: { encounters: bool, allergies: bool, ... } }
// Если approvedScopes не передан → пациент одобряет ВСЁ что просили.
// Если передан → должен быть подмножеством requestedScopes.

export async function approveRequest(req, res) {
  const userId = requirePatient(req, res);
  if (!userId) return;

  const requestId = req.params.id;
  const { approvedScopes } = req.body || {};

  if (!requestId) {
    return res.status(400).json({ message: "Request id is required" });
  }
  if (approvedScopes !== undefined && typeof approvedScopes !== "object") {
    return res
      .status(400)
      .json({ message: "approvedScopes must be an object" });
  }

  try {
    const { request, consent } = await consentRequestService.approveRequest({
      requestId,
      approvedScopes,
      actor: actorFromSession(req),
      context: contextFromReq(req),
    });
    res.status(200).json({
      request,
      consent,
      action: "approved",
    });
  } catch (err) {
    console.error("[consentRequest.approveRequest]", err);
    if (err.code === "NOT_FOUND") {
      return res.status(404).json({ message: "Consent request not found" });
    }
    if (err.code === "NOT_PENDING") {
      return res.status(409).json({ message: err.message });
    }
    if (err.code === "FORBIDDEN") {
      return res.status(403).json({ message: err.message });
    }
    if (
      err.code === "SCOPES_OUT_OF_RANGE" ||
      err.code === "ZERO_SCOPES_APPROVED"
    ) {
      return res.status(422).json({ message: err.message });
    }
    if (err.name === "ValidationError") {
      return res.status(422).json({ message: err.message });
    }
    res.status(500).json({ message: "Failed to approve consent request" });
  }
}

// ─── POST /patient-profile/consent-requests/:id/reject ───────────────
// Body (optional): { note: "..." }

export async function rejectRequest(req, res) {
  const userId = requirePatient(req, res);
  if (!userId) return;

  const requestId = req.params.id;
  const { note } = req.body || {};

  if (!requestId) {
    return res.status(400).json({ message: "Request id is required" });
  }
  if (note !== undefined && typeof note !== "string") {
    return res.status(400).json({ message: "note must be a string" });
  }

  try {
    const request = await consentRequestService.rejectRequest({
      requestId,
      note: typeof note === "string" ? note.slice(0, 500) : null,
      actor: actorFromSession(req),
      context: contextFromReq(req),
    });
    res.status(200).json({
      request,
      action: "rejected",
    });
  } catch (err) {
    console.error("[consentRequest.rejectRequest]", err);
    if (err.code === "NOT_FOUND") {
      return res.status(404).json({ message: "Consent request not found" });
    }
    if (err.code === "NOT_PENDING") {
      return res.status(409).json({ message: err.message });
    }
    if (err.code === "FORBIDDEN") {
      return res.status(403).json({ message: err.message });
    }
    res.status(500).json({ message: "Failed to reject consent request" });
  }
}

export default {
  listMyPendingRequests,
  approveRequest,
  rejectRequest,
};
