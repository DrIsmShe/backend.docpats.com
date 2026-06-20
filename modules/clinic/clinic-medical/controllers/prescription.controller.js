// modules/clinic/clinic-medical/controllers/prescription.controller.js
//
// Thin HTTP controllers for clinic-medical prescriptions. Stage 2 #4.
//
// ─────────────────────────────────────────────────────────────────────────
//  AUDIT for createPrescription (manual call — Phase 2B pattern, mirrors
//  imaging.controller.js)
// ─────────────────────────────────────────────────────────────────────────
//
// auditMiddleware can't run on POST because it needs a resourceId, which
// doesn't exist until after service.createPrescription. We call
// recordActionAsync directly here with the saved doc's _id. The other
// routes (read/list/cancel/complete/delete/pdf) keep auditMiddleware —
// their resourceId comes from params.
//
// Param shape matches audit.service.recordAction exactly:
//   { actor: { userId, email, role }, action, resourceType, resourceId,
//     resourceOwnerId, outcome, metadata, context: { httpMethod, ... } }

import * as prescriptionService from "../services/prescription.service.js";
import { recordActionAsync } from "../../../audit/services/audit.service.js";
import { ACTIONS } from "../rbac/clinicMedicalRBAC.js";

// ─── audit helpers (match audit.service.recordAction shape) ──────────

function buildActor(req) {
  const ctx = req.tenantContext || {};
  return {
    userId: ctx.userId || null,
    role: ctx.role || null,
    email: req.user?.email || req.session?.email || null,
  };
}

function buildAuditContext(req, statusCode) {
  return {
    httpMethod: req.method,
    httpPath: req.originalUrl || req.url,
    statusCode,
    ipAddress: req.ip || req.connection?.remoteAddress || null,
    userAgent: req.get?.("user-agent") || null,
    sessionId: req.sessionID || req.session?.id || null,
  };
}

// ─── POST /patients/:patientId/prescriptions ──────────────────────────
// Audit is recorded HERE (not via middleware) because resourceId only
// exists after the service creates the document.
export async function createPrescriptionController(req, res, next) {
  let result;
  try {
    result = await prescriptionService.createPrescription({
      patient: req.clinicPatient,
      body: req.body || {},
    });
  } catch (err) {
    // Best-effort audit on failure (fire-and-forget — won't throw)
    recordActionAsync({
      actor: buildActor(req),
      action: ACTIONS.PRESCRIPTION.CREATE,
      resourceType: "clinic-medical-prescription",
      // resourceId omitted — record was never created
      resourceOwnerId: req.clinicPatient?.linkedUserId || null,
      outcome: err.status === 403 ? "denied" : "failure",
      failureReason: err.message,
      metadata: {
        patientId: req.params?.patientId,
        itemCount: Array.isArray(req.body?.items) ? req.body.items.length : 0,
      },
      context: buildAuditContext(req, err.status || 500),
    });
    // Bubble to centralized error handler
    return next(err);
  }

  // Record audit with the freshly-minted resourceId. fire-and-forget.
  recordActionAsync({
    actor: buildActor(req),
    action: ACTIONS.PRESCRIPTION.CREATE,
    resourceType: "clinic-medical-prescription",
    resourceId: result._id,
    resourceOwnerId: req.clinicPatient?.linkedUserId || null,
    outcome: "success",
    metadata: {
      patientId: req.params?.patientId,
      itemCount: Array.isArray(result.items) ? result.items.length : 0,
      hasDiagnosis: Boolean(result.diagnosis?.code || result.diagnosis?.text),
    },
    context: buildAuditContext(req, 201),
  });

  return res.status(201).json({ prescription: result });
}

// ─── GET /patients/:patientId/prescriptions ───────────────────────────
export async function listPrescriptionsController(req, res) {
  const result = await prescriptionService.listPrescriptionsForPatient({
    patient: req.clinicPatient,
    query: req.query || {},
  });
  res.status(200).json(result); // { items, nextCursor, count }
}

// ─── GET /prescriptions/:id ────────────────────────────────────────────
export async function getPrescriptionController(req, res) {
  const result = await prescriptionService.getPrescription({
    record: req.medicalRecord,
    consentDecision: req.consentDecision,
    role: req.tenantContext?.role || null,
  });
  res.status(200).json({ prescription: result });
}

// ─── PATCH /prescriptions/:id/cancel ───────────────────────────────────
export async function cancelPrescriptionController(req, res) {
  const result = await prescriptionService.cancelPrescription({
    record: req.medicalRecord,
    body: req.body || {},
  });
  res.status(200).json({ prescription: result });
}

// ─── PATCH /prescriptions/:id/complete ─────────────────────────────────
export async function completePrescriptionController(req, res) {
  const result = await prescriptionService.completePrescription({
    record: req.medicalRecord,
  });
  res.status(200).json({ prescription: result });
}

// ─── DELETE /prescriptions/:id (owner only — enforced by RBAC) ─────────
export async function deletePrescriptionController(req, res) {
  const result = await prescriptionService.deletePrescription({
    record: req.medicalRecord,
  });
  res.status(200).json(result); // { prescriptionId, deleted: true }
}

// ─── GET /prescriptions/:id/pdf ────────────────────────────────────────
// Full content (no cross-clinic strip) — RBAC ensures only doctor/owner/
// admin of owning clinic reach here, and checkConsent gates access.
//
// IMPORTANT: wrapped in try/catch + next(err). buildPrescriptionPdf throws
// synchronously if Noto fonts are missing; without this wrapper the throw
// escaped as an Unhandled Rejection and NO HTTP response was sent — the
// client's await hung forever, leaving its busy-state stuck.
export async function prescriptionPdfController(req, res, next) {
  try {
    const data = await prescriptionService.getPrescriptionForPdf({
      record: req.medicalRecord,
    });

    const { buildPrescriptionPdf } =
      await import("../pdf/prescriptionPdf.js").catch(() => ({
        buildPrescriptionPdf: null,
      }));

    if (!buildPrescriptionPdf) {
      // PDF generator not wired yet — return JSON so the endpoint is testable.
      return res.status(200).json({ prescription: data, pdf: "not_wired_yet" });
    }

    const clinic = req.clinic || null;
    const pdfBuffer = await buildPrescriptionPdf({
      prescription: data,
      clinic,
      patient: req.clinicPatient || null,
      lang: req.query?.lang || req.tenantContext?.lang || "ru",
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="prescription-${data._id}.pdf"`,
    );
    return res.status(200).send(pdfBuffer);
  } catch (err) {
    // Surface as a normal error response so the client's request resolves
    // (centralized error handler maps it to a JSON 500/4xx).
    return next(err);
  }
}
