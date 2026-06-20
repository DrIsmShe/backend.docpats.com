// modules/clinic/clinic-medical/services/labResult.service.js
//
// Business logic for clinic-medical lab results (Stage 2 — A, Variant X).
// Mirrors prescription.service.js EXACTLY (consent, cross-clinic, FSM, events).
//
// Lab-specific additions:
//   • computeFlag + loincFor applied on save (shared standards layer)
//   • FSM: preliminary → final → corrected | amended  (lab semantics)
//   • getLabTrend — динамика одного показателя во времени (#7)
//   • attachedFile (R2) carried through shape
//
// PHI stored PLAINTEXT (consistent with medical domain).

import LabResult from "../models/labResult.model.js";
import PatientConsent from "../../../../common/models/Polyclinic/PatientConsent.js";
import { eventBus, EVENTS } from "../../../../common/events/eventBus.js";
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
  UnprocessableError,
} from "../../../../common/utils/errors.js";
import {
  getCurrentClinicId,
  getCurrentUserId,
  getCurrentActorType,
} from "../../../../common/context/tenantContext.js";
import { require as requirePerm } from "../../../../common/auth/can.js";
import {
  computeFlag,
  loincFor,
  canonUnit,
} from "../../../../common/standards/labStandards.js";
import logger from "../../../../common/logger.js";

const log = logger.child({ module: "clinic-medical/labResult.service" });

// FSM transitions
const STATUS_TRANSITIONS = {
  preliminary: ["final"],
  final: ["corrected", "amended"],
  corrected: ["amended"],
  amended: [],
};

// ─── helpers (identical to prescription.service) ──────────────────────

function requireClinicId() {
  const clinicId = getCurrentClinicId();
  if (!clinicId) throw new ForbiddenError("No active clinic context");
  return clinicId;
}

function requireActor() {
  const userId = getCurrentUserId();
  const actorType = getCurrentActorType();
  if (!userId || !actorType) {
    throw new ForbiddenError("Authenticated actor required");
  }
  return { userId, actorType };
}

/**
 * Normalize + enrich one incoming parameter:
 *  - canon unit (UCUM)
 *  - auto-fill loincCode if missing (from name)
 *  - compute + persist flag (value vs referenceRange)
 * The subschema pre-validate also normalizes value/unit; we enrich here so the
 * stored doc already carries flag/loinc (graphs + interpretation are free).
 */
function normalizeParameters(rawParams) {
  if (!Array.isArray(rawParams)) return [];
  return rawParams
    .filter((p) => p && typeof p.name === "string" && p.name.trim())
    .map((p) => {
      const valueType = p.valueType === "number" ? "number" : "text";

      const referenceRange =
        valueType === "number"
          ? {
              min: p.referenceRange?.min ?? null,
              max: p.referenceRange?.max ?? null,
              text: null,
            }
          : {
              min: null,
              max: null,
              text: p.referenceRange?.text
                ? String(p.referenceRange.text).trim()
                : null,
            };

      const param = {
        name: p.name.trim(),
        loincCode: p.loincCode || loincFor(p.name) || null,
        valueType,
        value: p.value,
        unit: valueType === "number" ? canonUnit(p.unit || "") : "—",
        referenceRange,
      };

      // flag computed from the normalized shape
      param.flag = computeFlag({
        valueType: param.valueType,
        value: param.value,
        referenceRange: param.referenceRange,
      });

      return param;
    });
}

/** API response shape (PHI plaintext — no decryption). */
function toApiShape(doc) {
  if (!doc) return null;
  return {
    _id: String(doc._id),
    status: doc.status,

    patientTypeModel: doc.patientTypeModel,
    patientRef: doc.patientRef ? String(doc.patientRef) : null,
    encounterId: doc.encounterId ? String(doc.encounterId) : null,

    createdBy: doc.createdBy ? String(doc.createdBy) : null,
    createdByEmployee: doc.createdByEmployee
      ? String(doc.createdByEmployee)
      : null,
    createdByClinicId: doc.createdByClinicId
      ? String(doc.createdByClinicId)
      : null,

    panelType: doc.panelType || "Other",
    panelTitle: doc.panelTitle || null,
    effectiveDateTime: doc.effectiveDateTime || null,

    sharedWith: Array.isArray(doc.sharedWith)
      ? doc.sharedWith.map((id) => String(id))
      : [],

    labName: doc.labName || "",
    report: doc.report || "",
    diagnosis: doc.diagnosis
      ? {
          code: doc.diagnosis.code || "",
          codeTitle: doc.diagnosis.codeTitle || "",
          text: doc.diagnosis.text || "",
        }
      : null,

    parameters: Array.isArray(doc.parameters)
      ? doc.parameters.map((p) => ({
          name: p.name || "",
          loincCode: p.loincCode || null,
          valueType: p.valueType,
          value: p.value,
          unit: p.unit || "—",
          referenceRange: p.referenceRange
            ? {
                min: p.referenceRange.min ?? null,
                max: p.referenceRange.max ?? null,
                text: p.referenceRange.text ?? null,
              }
            : null,
          flag: p.flag || "normal",
        }))
      : [],

    attachedFile: doc.attachedFile?.key
      ? {
          key: doc.attachedFile.key,
          url: doc.attachedFile.url || null,
          fileName: doc.attachedFile.fileName || null,
          mimeType: doc.attachedFile.mimeType || null,
          size: doc.attachedFile.size ?? null,
          uploadedAt: doc.attachedFile.uploadedAt || null,
        }
      : null,

    comments: Array.isArray(doc.comments) ? doc.comments : [],

    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** Strip PHI for cross-clinic reads by non-doctor roles (drug/lab values reveal dx). */
function filterCrossClinicShape(shape, consentDecision, role) {
  if (!consentDecision?.isCrossClinic) return shape;
  if (["doctor", "owner", "admin"].includes(role)) return shape;

  return {
    _id: shape._id,
    status: shape.status,
    patientRef: shape.patientRef,
    encounterId: shape.encounterId,
    createdByClinicId: shape.createdByClinicId,
    panelType: shape.panelType,
    effectiveDateTime: shape.effectiveDateTime,
    sharedWith: shape.sharedWith,
    isCrossClinic: true,
    labName: null,
    report: null,
    diagnosis: null,
    parameters: [],
    attachedFile: null,
    comments: [],
    createdAt: shape.createdAt,
    updatedAt: shape.updatedAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────
//  CREATE
// ─────────────────────────────────────────────────────────────────────────
export async function createLabResult({ patient, body }) {
  requirePerm("medical_record", "write");
  const clinicId = requireClinicId();
  const { userId, actorType } = requireActor();

  if (!patient || !patient._id) {
    throw new UnprocessableError("Patient is required");
  }

  const parameters = normalizeParameters(body.parameters);
  const hasFile = !!body.attachedFile?.key;
  if (parameters.length === 0 && !hasFile && !(body.report || "").trim()) {
    throw new UnprocessableError(
      "Lab result requires at least one parameter, a report, or an attached file",
    );
  }

  const authorship =
    actorType === "employee"
      ? {
          createdBy: null,
          createdByEmployee: userId,
          createdByClinicId: clinicId,
        }
      : {
          createdBy: userId,
          createdByEmployee: null,
          createdByClinicId: clinicId,
        };

  const diagnosis = body.diagnosis
    ? {
        code: (body.diagnosis.code || "").trim(),
        codeTitle: (body.diagnosis.codeTitle || "").trim(),
        text: (body.diagnosis.text || "").trim(),
      }
    : { code: "", codeTitle: "", text: "" };

  const status =
    STATUS_TRANSITIONS[body.status] !== undefined ? body.status : "final";

  const docPayload = {
    patientTypeModel: "ClinicPatient",
    patientRef: patient._id,
    encounterId: body.encounterId || null,
    ...authorship,

    panelType: body.panelType || "Other",
    panelTitle: (body.panelTitle || "").trim() || null,
    status,
    effectiveDateTime: body.effectiveDateTime
      ? new Date(body.effectiveDateTime)
      : new Date(),

    parameters,
    report: (body.report || "").trim(),
    diagnosis,
    labName: (body.labName || "").trim(),

    attachedFile: hasFile
      ? {
          key: body.attachedFile.key,
          url: body.attachedFile.url || null,
          fileName: body.attachedFile.fileName || null,
          mimeType: body.attachedFile.mimeType || null,
          size: body.attachedFile.size ?? null,
          uploadedAt: new Date(),
        }
      : undefined,

    sharedWith: Array.isArray(body.sharedWith) ? body.sharedWith : [],
  };

  let lab;
  try {
    lab = new LabResult(docPayload);
    await lab.save();
  } catch (err) {
    if (
      err.name === "ValidationError" ||
      err.message?.includes("exactly one of") ||
      err.message?.includes("Lab parameter")
    ) {
      throw new UnprocessableError(err.message);
    }
    throw err;
  }

  log.info(
    {
      labResultId: String(lab._id),
      clinicId: String(clinicId),
      patientId: String(patient._id),
      panelType: lab.panelType,
      paramCount: parameters.length,
      actorType,
    },
    "LabResult created",
  );

  eventBus.emitSafe(EVENTS.MEDICAL_LAB_RESULT_CREATED, {
    labResultId: String(lab._id),
    clinicId: String(clinicId),
    patientId: String(patient._id),
    createdBy: String(userId),
    actorType,
  });

  return toApiShape(lab.toObject());
}

// ─────────────────────────────────────────────────────────────────────────
//  GET (single)
// ─────────────────────────────────────────────────────────────────────────
export async function getLabResult({ record, consentDecision, role }) {
  requirePerm("medical_record", "read");
  requireClinicId();
  if (!record) throw new NotFoundError("LabResult");
  const shape = toApiShape(record.toObject ? record.toObject() : record);
  return filterCrossClinicShape(shape, consentDecision, role);
}

// ─────────────────────────────────────────────────────────────────────────
//  LIST FOR PATIENT
// ─────────────────────────────────────────────────────────────────────────
export async function listLabResultsForPatient({ patient, query }) {
  requirePerm("medical_record", "read");
  const clinicId = requireClinicId();

  if (!patient || !patient._id) {
    throw new UnprocessableError("Patient is required");
  }

  const { limit = 50, before, status, panelType } = query || {};

  const hasGlobalConsent = await PatientConsent.checkScope(
    patient._id,
    clinicId,
    "encounters",
  );

  const accessOr = [{ createdByClinicId: clinicId }, { sharedWith: clinicId }];
  if (hasGlobalConsent) accessOr.push({});

  const filter = {
    patientRef: patient._id,
    patientTypeModel: "ClinicPatient",
    $or: accessOr,
  };
  if (status) filter.status = status;
  if (panelType) filter.panelType = panelType;
  if (before) filter.effectiveDateTime = { $lt: before };

  const docs = await LabResult.find(filter)
    .sort({ effectiveDateTime: -1 })
    .limit(Math.min(limit, 100))
    .lean();

  const items = docs.map((doc) => {
    const shape = toApiShape(doc);
    const isCrossClinic =
      !doc.createdByClinicId ||
      String(doc.createdByClinicId) !== String(clinicId);
    if (isCrossClinic) shape.isCrossClinic = true;
    return shape;
  });

  const nextCursor =
    docs.length === limit && docs[docs.length - 1]
      ? docs[docs.length - 1].effectiveDateTime
      : null;

  return { items, nextCursor, count: items.length };
}

// ─────────────────────────────────────────────────────────────────────────
//  UPDATE STATUS (FSM)
// ─────────────────────────────────────────────────────────────────────────
export async function updateLabResultStatus({ record, body = {} }) {
  requirePerm("medical_record", "write");
  requireClinicId();
  const { userId } = requireActor();

  if (!record) throw new NotFoundError("LabResult");

  const next = body.status;
  const allowed = STATUS_TRANSITIONS[record.status] || [];
  if (!allowed.includes(next)) {
    throw new ConflictError(
      `Cannot transition lab result from '${record.status}' to '${next}'.`,
      { code: "INVALID_STATUS_TRANSITION", currentStatus: record.status },
    );
  }

  record.status = next;
  await record.save();

  log.info(
    { labResultId: String(record._id), newStatus: next, by: String(userId) },
    "LabResult status updated",
  );

  eventBus.emitSafe(EVENTS.MEDICAL_LAB_RESULT_UPDATED, {
    labResultId: String(record._id),
    clinicId: String(record.createdByClinicId),
    newStatus: next,
    by: String(userId),
  });

  return toApiShape(record.toObject());
}

// ─────────────────────────────────────────────────────────────────────────
//  ADD COMMENT
// ─────────────────────────────────────────────────────────────────────────
export async function addLabComment({ record, body = {} }) {
  requirePerm("medical_record", "write");
  requireClinicId();
  const { userId, actorType } = requireActor();

  if (!record) throw new NotFoundError("LabResult");
  const text = (body.text || "").trim();
  if (!text) throw new UnprocessableError("Comment text is required");

  record.comments.push({
    authorUser: actorType === "employee" ? null : userId,
    authorEmployee: actorType === "employee" ? userId : null,
    text: text.slice(0, 2000),
    createdAt: new Date(),
  });
  await record.save();

  return toApiShape(record.toObject());
}

// ─────────────────────────────────────────────────────────────────────────
//  DELETE (owner only via RBAC)
// ─────────────────────────────────────────────────────────────────────────
export async function deleteLabResult({ record }) {
  requirePerm("medical_record", "delete");
  requireClinicId();
  const { userId } = requireActor();

  if (!record) throw new NotFoundError("LabResult");

  const clinicIdForEvent = record.createdByClinicId
    ? String(record.createdByClinicId)
    : null;
  const recordId = String(record._id);
  const fileKey = record.attachedFile?.key || null;

  await record.deleteOne();

  log.warn(
    { labResultId: recordId, deletedBy: String(userId) },
    "LabResult HARD-DELETED — preserved only in audit log",
  );

  eventBus.emitSafe(EVENTS.MEDICAL_LAB_RESULT_DELETED, {
    labResultId: recordId,
    clinicId: clinicIdForEvent,
    deletedBy: String(userId),
    // controller can delete fileKey from R2 after this resolves
    attachedFileKey: fileKey,
  });

  return { labResultId: recordId, deleted: true, attachedFileKey: fileKey };
}

// ─────────────────────────────────────────────────────────────────────────
//  GET FOR PDF (raw — no cross-clinic strip; PDF only own/doctor)
// ─────────────────────────────────────────────────────────────────────────
export async function getLabResultForPdf({ record }) {
  requirePerm("medical_record", "read");
  requireClinicId();
  if (!record) throw new NotFoundError("LabResult");
  return toApiShape(record.toObject ? record.toObject() : record);
}

// ─────────────────────────────────────────────────────────────────────────
//  GET TREND — динамика одного показателя по времени (#7)
//  Возвращает точки { date, value, unit, flag } для заданного имени показателя
//  (опц. сужение по loincCode), по всем доступным записям пациента.
// ─────────────────────────────────────────────────────────────────────────
export async function getLabTrend({ patient, query }) {
  requirePerm("medical_record", "read");
  const clinicId = requireClinicId();

  if (!patient || !patient._id) {
    throw new UnprocessableError("Patient is required");
  }
  const paramName = (query?.name || "").trim();
  const loincCode = (query?.loincCode || "").trim();
  if (!paramName && !loincCode) {
    throw new UnprocessableError("Either name or loincCode is required");
  }

  const hasGlobalConsent = await PatientConsent.checkScope(
    patient._id,
    clinicId,
    "encounters",
  );
  const accessOr = [{ createdByClinicId: clinicId }, { sharedWith: clinicId }];
  if (hasGlobalConsent) accessOr.push({});

  const docs = await LabResult.find({
    patientRef: patient._id,
    patientTypeModel: "ClinicPatient",
    $or: accessOr,
  })
    .select("effectiveDateTime parameters")
    .sort({ effectiveDateTime: 1 })
    .limit(500)
    .lean();

  const nameLc = paramName.toLowerCase();
  const points = [];
  for (const doc of docs) {
    for (const p of doc.parameters || []) {
      const match = loincCode
        ? p.loincCode === loincCode
        : (p.name || "").toLowerCase() === nameLc;
      if (
        match &&
        p.valueType === "number" &&
        Number.isFinite(Number(p.value))
      ) {
        points.push({
          date: doc.effectiveDateTime || doc.createdAt,
          value: Number(p.value),
          unit: p.unit || "—",
          flag: p.flag || "normal",
          referenceRange: p.referenceRange || null,
        });
      }
    }
  }

  return {
    name: paramName || null,
    loincCode: loincCode || null,
    unit: points[0]?.unit || null,
    points,
    count: points.length,
  };
}
