// modules/clinic/clinic-medical/controllers/labResult.controller.js
//
// HTTP controllers for clinic-medical lab results (Stage 2 — A, Variant X).
// Mirrors imaging.controller.js (manual audit on create) + prescription
// controllers (cancel/complete/pdf) exactly.
//
// File upload: optional single original file (PDF/image) via multer →
// processFiles → req.uploadedFiles[0] → attachedFile (R2). Same ALS rebind
// pattern as imaging.

import { z } from "zod";
import * as svc from "../services/labResult.service.js";
import { recordActionAsync } from "../../../audit/services/audit.service.js";
import { ACTIONS } from "../rbac/clinicMedicalRBAC.js";
import {
  UnprocessableError,
  toErrorResponse,
} from "../../../../common/utils/errors.js";

const LR = ACTIONS.LAB_RESULT;

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

const PANEL_TYPES = [
  "BloodTestGeneral",
  "BloodTestBiochemistry",
  "UrineTest",
  "StoolTest",
  "HormonePanel",
  "TumorMarkers",
  "PCR",
  "Immunology",
  "GeneticScreening",
  "CoagulationPanel",
  "LipidProfile",
  "LiverFunction",
  "RenalElectrolytes",
  "IronStudies",
  "DiabetesPanel",
  "ThyroidPanel",
  "CardiacMarkers",
  "VitaminsTrace",
  "InfectiousSerology",
  "UrineAlbuminACR",
  "StoolInflammation",
  "Other",
];

const referenceRangeSchema = z
  .object({
    min: z.coerce.number().nullable().optional(),
    max: z.coerce.number().nullable().optional(),
    text: z.string().trim().nullable().optional(),
  })
  .nullable()
  .optional();

const parameterSchema = z.object({
  name: z.string().trim().min(1),
  loincCode: z.string().trim().nullable().optional(),
  valueType: z.enum(["number", "text"]),
  value: z.any(),
  unit: z.string().trim().optional(),
  referenceRange: referenceRangeSchema,
});

// parameters arrive as JSON string in multipart, or array in JSON body
const parametersField = z.preprocess((v) => {
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}, z.array(parameterSchema).optional().default([]));

const diagnosisField = z.preprocess(
  (v) => {
    if (typeof v === "string" && v.trim().startsWith("{")) {
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    }
    return v;
  },
  z
    .object({
      code: z.string().trim().optional(),
      codeTitle: z.string().trim().optional(),
      text: z.string().trim().optional(),
    })
    .nullable()
    .optional(),
);

const createLabSchema = z.object({
  panelType: z.enum(PANEL_TYPES).optional().default("Other"),
  panelTitle: z.string().trim().optional().nullable(),
  status: z.enum(["preliminary", "final", "corrected", "amended"]).optional(),
  effectiveDateTime: z.coerce.date().optional(),
  parameters: parametersField,
  report: z.string().trim().optional().nullable(),
  diagnosis: diagnosisField,
  labName: z.string().trim().optional().nullable(),
  encounterId: z.string().regex(objectIdRegex).optional().nullable(),
  sharedWith: sharedWithSchema,
});

const statusSchema = z.object({
  status: z.enum(["final", "corrected", "amended"]),
});

const commentSchema = z.object({
  text: z.string().trim().min(1).max(2000),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.date().optional(),
  status: z.string().optional(),
  panelType: z.string().optional(),
});

const trendQuerySchema = z.object({
  name: z.string().trim().optional(),
  loincCode: z.string().trim().optional(),
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

// ─── POST /patients/:patientId/lab-results (multipart, optional file) ──
// No auditMiddleware — manual recordActionAsync after create (imaging pattern).
export async function createLabResultController(req, res) {
  let body;
  try {
    body = parse(createLabSchema, req.body, "lab result create body");
  } catch (err) {
    return handleError(res, err);
  }

  // optional single original file (processFiles → req.uploadedFiles).
  // uploadMiddleware shape: { fileName, fileType(image|video|...),
  //   fileUrl(R2_PUBLIC_URL/uploads/...), fileSize, fileFormat(full mime) }.
  // R2 key is derived from the public URL (same way deleteFile does it).
  const uploaded = Array.isArray(req.uploadedFiles) ? req.uploadedFiles : [];
  const f = uploaded[0];
  const r2Public = process.env.R2_PUBLIC_URL || "";
  const deriveKey = (url) => {
    if (!url) return null;
    if (r2Public && url.startsWith(`${r2Public}/`)) {
      return url.slice(r2Public.length + 1);
    }
    // dev mode (local /uploads/...) — store path after origin
    const idx = url.indexOf("/uploads/");
    return idx >= 0 ? url.slice(idx + 1) : null; // "uploads/..."
  };
  const attachedFile = f
    ? {
        key: deriveKey(f.fileUrl),
        url: f.fileUrl || null,
        fileName: f.fileName || null,
        mimeType: f.fileFormat || null, // full mime (e.g. application/pdf)
        size: f.fileSize ?? null,
      }
    : undefined;

  let result;
  try {
    result = await svc.createLabResult({
      patient: req.clinicPatient,
      body: { ...body, attachedFile },
    });
  } catch (err) {
    recordActionAsync({
      actor: buildActor(req),
      action: LR.CREATE,
      resourceType: "clinic-medical-lab-result",
      resourceOwnerId: req.clinicPatient?.linkedUserId || null,
      outcome: err.status === 403 ? "denied" : "failure",
      failureReason: err.message,
      metadata: {
        patientId: req.params?.patientId,
        panelType: body?.panelType || null,
        paramCount: Array.isArray(body?.parameters)
          ? body.parameters.length
          : 0,
        hasFile: !!attachedFile,
      },
      context: buildAuditContext(req, err.status || 500),
    });
    return handleError(res, err);
  }

  recordActionAsync({
    actor: buildActor(req),
    action: LR.CREATE,
    resourceType: "clinic-medical-lab-result",
    resourceId: result._id,
    resourceOwnerId: req.clinicPatient?.linkedUserId || null,
    outcome: "success",
    metadata: {
      patientId: req.params?.patientId,
      panelType: result.panelType,
      paramCount: result.parameters?.length || 0,
      hasFile: !!result.attachedFile,
    },
    context: buildAuditContext(req, 201),
  });

  return res.status(201).json({ success: true, labResult: result });
}

// ─── GET /patients/:patientId/lab-results ─────────────────────────────
export async function listLabResultsController(req, res) {
  try {
    const query = parse(listQuerySchema, req.query, "lab list query");
    const result = await svc.listLabResultsForPatient({
      patient: req.clinicPatient,
      query,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─── GET /patients/:patientId/lab-results/trend ───────────────────────
export async function labTrendController(req, res) {
  try {
    const query = parse(trendQuerySchema, req.query, "lab trend query");
    const result = await svc.getLabTrend({
      patient: req.clinicPatient,
      query,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─── GET /lab-results/:id ─────────────────────────────────────────────
export async function getLabResultController(req, res) {
  try {
    const result = await svc.getLabResult({
      record: req.medicalRecord,
      consentDecision: req.consentDecision,
      role: req.tenantContext?.role,
    });
    return res.json({ success: true, labResult: result });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─── PATCH /lab-results/:id/status ────────────────────────────────────
export async function updateLabStatusController(req, res) {
  try {
    const body = parse(statusSchema, req.body, "lab status body");
    const result = await svc.updateLabResultStatus({
      record: req.medicalRecord,
      body,
    });
    return res.json({ success: true, labResult: result });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─── POST /lab-results/:id/comments ───────────────────────────────────
export async function addLabCommentController(req, res) {
  try {
    const body = parse(commentSchema, req.body, "lab comment body");
    const result = await svc.addLabComment({
      record: req.medicalRecord,
      body,
    });
    return res.json({ success: true, labResult: result });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─── DELETE /lab-results/:id ──────────────────────────────────────────
export async function deleteLabResultController(req, res) {
  // capture attached file URL BEFORE delete (record still loaded)
  const attachedUrl = req.medicalRecord?.attachedFile?.url || null;
  try {
    const result = await svc.deleteLabResult({ record: req.medicalRecord });

    // queue attached original file for R2 cleanup (OrphanR2File), like imaging.
    // OrphanR2File stores fileUrl; cron calls deleteFile(fileUrl).
    if (attachedUrl) {
      try {
        const OrphanR2File = (
          await import("../../../../common/models/system/OrphanR2File.js")
        ).default;
        await OrphanR2File.create({
          fileUrl: attachedUrl,
          sourceModel: "LabResult",
          sourceId: result.labResultId,
          clinicId: req.tenantContext?.clinicId || null,
          deletedAt: new Date(),
        });
      } catch (e) {
        // deferred cleanup problem — don't fail the request
        console.error("LabResult orphan enqueue failed:", e?.message);
      }
    }

    return res.json({ success: true, ...result });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─── GET /lab-results/:id/pdf ─────────────────────────────────────────
export async function labResultPdfController(req, res, next) {
  try {
    const data = await svc.getLabResultForPdf({ record: req.medicalRecord });

    const { buildLabResultPdf } = await import("../pdf/labResultPdf.js");
    const pdfBuffer = await buildLabResultPdf({
      labResult: data,
      clinic: req.clinic || null,
      patient: req.clinicPatient || null,
      lang: req.query?.lang || "ru",
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="lab-result-${data._id}.pdf"`,
    );
    return res.status(200).send(pdfBuffer);
  } catch (err) {
    return next ? next(err) : handleError(res, err);
  }
}
