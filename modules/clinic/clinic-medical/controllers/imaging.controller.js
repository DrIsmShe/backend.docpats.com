// modules/clinic/clinic-medical/controllers/imaging.controller.js
//
// HTTP controllers for clinic-medical imaging studies. Sprint 2 Phase 2C.2.
//
// ─────────────────────────────────────────────────────────────────────────
//  AUDIT for createImaging (manual call — Phase 2B pattern)
// ─────────────────────────────────────────────────────────────────────────
//
// auditMiddleware can't run on POST because it needs a resourceId, which
// doesn't exist until after service.createImaging. We call recordActionAsync
// directly here with the saved doc's _id.
//
// Param shape matches audit.service.recordAction exactly:
//   { actor: { userId, email, role }, action, resourceType, resourceId,
//     resourceOwnerId, outcome, metadata, context: { httpMethod, ... } }
//
// Employee actors: req.tenantContext.userId holds the ClinicEmployee._id
// (set by tenantMiddleware in the employee branch — that is the canonical
// "actor id" the audit log expects).

import { z } from "zod";
import * as svc from "../services/imaging.service.js";
import { recordActionAsync } from "../../../audit/services/audit.service.js";
import { ACTIONS } from "../rbac/clinicMedicalRBAC.js";
import {
  UnprocessableError,
  toErrorResponse,
} from "../../../../common/utils/errors.js";

// ─── validators ──────────────────────────────────────────────────────

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const sharedWithSchema = z.preprocess(
  (value) => {
    if (value === undefined) return undefined;
    if (Array.isArray(value)) return value;
    if (typeof value === "string" && value.includes(",")) {
      return value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return [value];
  },
  z.array(z.string().regex(objectIdRegex)).optional(),
);

const boolFromForm = z.preprocess((v) => {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return v;
}, z.boolean().optional());

const createImagingSchema = z.object({
  studyType: z.enum([
    "CT",
    "MRI",
    "USG",
    "X-Ray",
    "PET",
    "SPECT",
    "EEG",
    "ECG",
    "Holter",
    "Spirometry",
    "Doppler",
    "Gastroscopy",
    "Colonoscopy",
    "CapsuleEndoscopy",
  ]),
  date: z.coerce.date().optional(),
  report: z.string().trim().optional().nullable(),
  diagnosis: z.string().trim().optional().nullable(),
  contrastUsed: boolFromForm,
  sharedWith: sharedWithSchema,
});

const updateImagingSchema = z.object({
  report: z.string().trim().optional().nullable(),
  diagnosis: z.string().trim().optional().nullable(),
  doctorNotes: z.string().trim().optional().nullable(),
  contrastUsed: boolFromForm,
  validatedByDoctor: boolFromForm,
  sharedWith: sharedWithSchema,
});

const listImagingQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  before: z.coerce.date().optional(),
  studyType: z.string().optional(),
});

function parse(schema, source, label) {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new UnprocessableError(`Invalid ${label}`, result.error.flatten());
  }
  return result.data;
}

function handleError(res, err) {
  const { status, body } = toErrorResponse(err);
  return res.status(status).json(body);
}

// ─── audit helpers (match audit.service.recordAction shape) ──────────

function buildActor(req) {
  const ctx = req.tenantContext || {};
  return {
    // tenantMiddleware sets userId = User._id (user branch) or
    // ClinicEmployee._id (employee branch). Both serve as actor identity.
    userId: ctx.userId || null,
    role: ctx.role || null,
    // email best-effort; fall back to session.user if available
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

// ─── POST /patients/:patientId/imaging ────────────────────────────────

export async function createImaging(req, res) {
  let body;
  try {
    body = parse(createImagingSchema, req.body, "imaging create body");
  } catch (err) {
    return handleError(res, err);
  }

  const uploaded = Array.isArray(req.uploadedFiles) ? req.uploadedFiles : [];
  const images = uploaded.map((f) => f.fileUrl).filter(Boolean);
  const files = uploaded.map((f) => ({
    fileName: f.fileName,
    fileUrl: f.fileUrl,
    fileType: f.fileType,
    fileSize: f.fileSize,
    fileFormat: f.fileFormat,
  }));

  let result;
  try {
    result = await svc.createImaging({
      patient: req.clinicPatient,
      body,
      images,
      files,
    });
  } catch (err) {
    // Best-effort audit on failure (fire-and-forget — won't throw)
    recordActionAsync({
      actor: buildActor(req),
      action: ACTIONS.IMAGING.CREATE,
      resourceType: "clinic-medical-imaging-study",
      // resourceId omitted — record was never created
      resourceOwnerId: req.clinicPatient?.linkedUserId || null,
      outcome: err.status === 403 ? "denied" : "failure",
      failureReason: err.message,
      metadata: {
        patientId: req.params?.patientId,
        studyType: body?.studyType || null,
        fileCount: uploaded.length,
      },
      context: buildAuditContext(req, err.status || 500),
    });
    return handleError(res, err);
  }

  // Record audit with the freshly-minted resourceId. fire-and-forget.
  recordActionAsync({
    actor: buildActor(req),
    action: ACTIONS.IMAGING.CREATE,
    resourceType: "clinic-medical-imaging-study",
    resourceId: result._id,
    resourceOwnerId: req.clinicPatient?.linkedUserId || null,
    outcome: "success",
    metadata: {
      patientId: req.params?.patientId,
      studyType: body?.studyType || null,
      fileCount: uploaded.length,
    },
    context: buildAuditContext(req, 201),
  });

  return res.status(201).json({ success: true, imaging: result });
}

// ─── GET /imaging/:recordId ───────────────────────────────────────────

export async function getImaging(req, res) {
  try {
    const recordId = req.params.recordId || req.params.id;
    const result = await svc.getImaging({ recordId });
    return res.json({ success: true, imaging: result });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─── GET /patients/:patientId/imaging ─────────────────────────────────

export async function listImaging(req, res) {
  try {
    const query = parse(
      listImagingQuerySchema,
      req.query,
      "imaging list query",
    );
    const result = await svc.listImaging({
      patient: req.clinicPatient,
      query,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─── PATCH /imaging/:recordId ─────────────────────────────────────────

export async function updateImaging(req, res) {
  try {
    const recordId = req.params.recordId || req.params.id;
    const body = parse(updateImagingSchema, req.body, "imaging update body");
    const result = await svc.updateImaging({ recordId, body });
    return res.json({ success: true, imaging: result });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─── DELETE /imaging/:recordId ────────────────────────────────────────

export async function deleteImaging(req, res) {
  try {
    const recordId = req.params.recordId || req.params.id;
    const result = await svc.deleteImaging({ recordId });
    return res.json({ success: true, ...result });
  } catch (err) {
    return handleError(res, err);
  }
}
