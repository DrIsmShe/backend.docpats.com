// modules/clinic/clinic-medical/services/prescription.service.js
//
// Business logic for clinic-medical prescriptions.
// Sprint 2 Phase 2C (Medical Workflow) — Stage 2 #4.
//
// WHO Good Prescribing item structure (revision 2 Jun 2026):
//   inn (required) / brandName / strength / form / route / dose /
//   frequency / duration / quantity / prn / instructions
//
// ─────────────────────────────────────────────────────────────────────────────
//  ARCHITECTURE — mirrors medicalHistory.service.js exactly
// ─────────────────────────────────────────────────────────────────────────────
//
// 1. tenantContext (AsyncLocalStorage) provides clinicId + userId + actorType.
// 2. Permission gate via requirePerm — coarse. Fine RBAC at middleware.
// 3. READ access decisions live in checkConsent middleware → req.consentDecision.
// 4. PHI stored PLAINTEXT (consistent with whole medical domain).
// 5. FSM: active → cancelled | completed. No draft. Terminal = immutable.
// 6. Audit via controller (create) / auditMiddleware (rest). Emits events.
//
// ─────────────────────────────────────────────────────────────────────────────

import Prescription from "../../../../common/models/Polyclinic/Prescription.js";
import { encryptPHI, decryptPHI } from "../../../../common/utils/phiCrypto.js";
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
import logger from "../../../../common/logger.js";

const log = logger.child({ module: "clinic-medical/prescription.service" });

// ─── helpers (identical to medicalHistory.service) ────────────────────

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
 * Normalize one incoming item into a clean WHO sub-doc shape.
 * Drops items without an INN (drug name) — WHO requires the generic name.
 */
function normalizeItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];
  return rawItems
    .filter((it) => it && typeof it.inn === "string" && it.inn.trim())
    .map((it) => ({
      inn: it.inn.trim(),
      brandName: (it.brandName || "").trim(),
      strength: (it.strength || "").trim(),
      form: it.form || "other",
      route: it.route || "oral",
      dose: (it.dose || "").trim(),
      frequency: (it.frequency || "").trim(),
      duration: (it.duration || "").trim(),
      quantity: (it.quantity || "").trim(),
      prn: !!it.prn,
      instructions: encryptPHI((it.instructions || "").trim()), // PHI
    }));
}

/**
 * Convert prescription document into API response shape.
 * PHI stored plaintext — no decryption needed.
 */
function toApiShape(doc) {
  if (!doc) return null;
  return {
    _id: String(doc._id),
    status: doc.status,

    // Patient link
    patientType: doc.patientType,
    patientTypeModel: doc.patientTypeModel,
    patientRef: doc.patientRef ? String(doc.patientRef) : null,
    encounterId: doc.encounterId ? String(doc.encounterId) : null,

    // Authorship (UMR)
    createdBy: doc.createdBy ? String(doc.createdBy) : null,
    createdByEmployee: doc.createdByEmployee
      ? String(doc.createdByEmployee)
      : null,
    createdByClinicId: doc.createdByClinicId
      ? String(doc.createdByClinicId)
      : null,

    // Issuing
    issuedAt: doc.issuedAt || null,
    issuedByUserId: doc.issuedByUserId ? String(doc.issuedByUserId) : null,
    issuedByEmployeeId: doc.issuedByEmployeeId
      ? String(doc.issuedByEmployeeId)
      : null,
    closedAt: doc.closedAt || null,
    closedReason: doc.closedReason || null,

    // Consent
    sharedWith: Array.isArray(doc.sharedWith)
      ? doc.sharedWith.map((id) => String(id))
      : [],

    // Content
    diagnosis: doc.diagnosis
      ? {
          code: doc.diagnosis.code || "",
          codeTitle: doc.diagnosis.codeTitle || "",
          text: decryptPHI(doc.diagnosis.text) || "",
        }
      : null,
    generalNotes: decryptPHI(doc.generalNotes) || "",
    items: Array.isArray(doc.items)
      ? doc.items.map((it) => ({
          _id: it._id ? String(it._id) : undefined,
          inn: it.inn || "",
          brandName: it.brandName || "",
          strength: it.strength || "",
          form: it.form || "other",
          route: it.route || "oral",
          dose: it.dose || "",
          frequency: it.frequency || "",
          duration: it.duration || "",
          quantity: it.quantity || "",
          prn: !!it.prn,
          instructions: decryptPHI(it.instructions) || "",
        }))
      : [],

    // Audit
    history: Array.isArray(doc.history) ? doc.history : [],

    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Strip PHI for cross-clinic reads by non-doctor roles.
 * Keep only existence + date + status (drug names reveal diagnosis).
 */
function filterCrossClinicShape(shape, consentDecision, role) {
  if (!consentDecision?.isCrossClinic) return shape;
  if (["doctor", "owner", "admin"].includes(role)) return shape;

  return {
    _id: shape._id,
    status: shape.status,
    patientRef: shape.patientRef,
    encounterId: shape.encounterId,
    createdByClinicId: shape.createdByClinicId,
    issuedAt: shape.issuedAt,
    closedAt: shape.closedAt,
    sharedWith: shape.sharedWith,
    isCrossClinic: true,
    diagnosis: null,
    generalNotes: null,
    items: [],
    history: [],
    createdAt: shape.createdAt,
    updatedAt: shape.updatedAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────
//  CREATE PRESCRIPTION
// ─────────────────────────────────────────────────────────────────────────

export async function createPrescription({ patient, body }) {
  requirePerm("medical_record", "write");
  const clinicId = requireClinicId();
  const { userId, actorType } = requireActor();

  if (!patient || !patient._id) {
    throw new UnprocessableError("Patient is required");
  }

  const items = normalizeItems(body.items);
  if (items.length === 0) {
    throw new UnprocessableError(
      "Prescription requires at least one item with an INN (drug name)",
    );
  }

  const now = new Date();

  const authorship =
    actorType === "employee"
      ? {
          createdBy: null,
          createdByEmployee: userId,
          createdByClinicId: clinicId,
          issuedByUserId: null,
          issuedByEmployeeId: userId,
        }
      : {
          createdBy: userId,
          createdByEmployee: null,
          createdByClinicId: clinicId,
          issuedByUserId: userId,
          issuedByEmployeeId: null,
        };

  const diagnosis = body.diagnosis
    ? {
        code: (body.diagnosis.code || "").trim(),
        codeTitle: (body.diagnosis.codeTitle || "").trim(),
        text: encryptPHI((body.diagnosis.text || "").trim()), // PHI
      }
    : { code: "", codeTitle: "", text: "" };

  const docPayload = {
    patientType: "registered",
    patientTypeModel: "ClinicPatient",
    patientRef: patient._id,
    encounterId: body.encounterId || null,

    ...authorship,
    issuedAt: now,
    status: "active",

    items,
    generalNotes: encryptPHI((body.generalNotes || "").trim()), // PHI
    diagnosis,

    sharedWith: Array.isArray(body.sharedWith) ? body.sharedWith : [],
  };

  let prescription;
  try {
    prescription = new Prescription(docPayload);
    await prescription.save();
  } catch (err) {
    if (
      err.name === "ValidationError" ||
      err.message?.includes("Author is required") ||
      err.message?.includes("Only one author allowed") ||
      err.message?.includes("createdByClinicId is required") ||
      err.message?.includes("at least one item") ||
      err.message?.includes("issuedBy")
    ) {
      throw new UnprocessableError(err.message);
    }
    throw err;
  }

  log.info(
    {
      prescriptionId: String(prescription._id),
      clinicId: String(clinicId),
      patientId: String(patient._id),
      itemCount: items.length,
      actorType,
    },
    "Prescription created",
  );

  eventBus.emitSafe(EVENTS.MEDICAL_PRESCRIPTION_CREATED, {
    prescriptionId: String(prescription._id),
    clinicId: String(clinicId),
    patientId: String(patient._id),
    createdBy: String(userId),
    actorType,
  });

  return toApiShape(prescription.toObject());
}

// ─────────────────────────────────────────────────────────────────────────
//  GET PRESCRIPTION (single)
// ─────────────────────────────────────────────────────────────────────────

export async function getPrescription({ record, consentDecision, role }) {
  requirePerm("medical_record", "read");
  requireClinicId();

  if (!record) throw new NotFoundError("Prescription");

  const shape = toApiShape(record.toObject ? record.toObject() : record);
  return filterCrossClinicShape(shape, consentDecision, role);
}

// ─────────────────────────────────────────────────────────────────────────
//  LIST PRESCRIPTIONS FOR PATIENT
// ─────────────────────────────────────────────────────────────────────────

export async function listPrescriptionsForPatient({ patient, query }) {
  requirePerm("medical_record", "read");
  const clinicId = requireClinicId();

  if (!patient || !patient._id) {
    throw new UnprocessableError("Patient is required");
  }

  const { limit = 50, before, status } = query || {};

  const hasGlobalConsent = await PatientConsent.checkScope(
    patient._id,
    clinicId,
    "encounters", // prescriptions ride on the "encounters" scope
  );

  const accessOr = [{ createdByClinicId: clinicId }, { sharedWith: clinicId }];
  if (hasGlobalConsent) {
    accessOr.push({});
  }

  const filter = {
    patientRef: patient._id,
    patientTypeModel: "ClinicPatient",
    $or: accessOr,
  };

  if (status) filter.status = status;
  if (before) filter.createdAt = { $lt: before };

  const docs = await Prescription.find(filter)
    .sort({ createdAt: -1 })
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
      ? docs[docs.length - 1].createdAt
      : null;

  return { items, nextCursor, count: items.length };
}

// ─────────────────────────────────────────────────────────────────────────
//  CANCEL PRESCRIPTION (active → cancelled)
// ─────────────────────────────────────────────────────────────────────────

export async function cancelPrescription({ record, body = {} }) {
  requirePerm("medical_record", "write");
  requireClinicId();
  const { userId } = requireActor();

  if (!record) throw new NotFoundError("Prescription");

  if (record.status !== "active") {
    throw new ConflictError(
      `Cannot cancel prescription in status='${record.status}'. Only active prescriptions can be cancelled.`,
      { code: "INVALID_STATUS_TRANSITION", currentStatus: record.status },
    );
  }

  const now = new Date();
  record.status = "cancelled";
  record.closedAt = now;
  record.closedReason = body.reason ? String(body.reason).slice(0, 500) : null;

  record.history.push({
    updatedBy: userId,
    updatedAt: now,
    changes: { field: "status", oldValue: "active", newValue: "cancelled" },
  });

  await record.save();

  log.info(
    { prescriptionId: String(record._id), cancelledBy: String(userId) },
    "Prescription cancelled",
  );

  eventBus.emitSafe(EVENTS.MEDICAL_PRESCRIPTION_CANCELLED, {
    prescriptionId: String(record._id),
    clinicId: String(record.createdByClinicId),
    cancelledBy: String(userId),
  });

  return toApiShape(record.toObject());
}

// ─────────────────────────────────────────────────────────────────────────
//  COMPLETE PRESCRIPTION (active → completed)
// ─────────────────────────────────────────────────────────────────────────

export async function completePrescription({ record }) {
  requirePerm("medical_record", "write");
  requireClinicId();
  const { userId } = requireActor();

  if (!record) throw new NotFoundError("Prescription");

  if (record.status !== "active") {
    throw new ConflictError(
      `Cannot complete prescription in status='${record.status}'. Only active prescriptions can be completed.`,
      { code: "INVALID_STATUS_TRANSITION", currentStatus: record.status },
    );
  }

  const now = new Date();
  record.status = "completed";
  record.closedAt = now;

  record.history.push({
    updatedBy: userId,
    updatedAt: now,
    changes: { field: "status", oldValue: "active", newValue: "completed" },
  });

  await record.save();

  log.info(
    { prescriptionId: String(record._id), completedBy: String(userId) },
    "Prescription completed",
  );

  eventBus.emitSafe(EVENTS.MEDICAL_PRESCRIPTION_COMPLETED, {
    prescriptionId: String(record._id),
    clinicId: String(record.createdByClinicId),
    completedBy: String(userId),
  });

  return toApiShape(record.toObject());
}

// ─────────────────────────────────────────────────────────────────────────
//  DELETE PRESCRIPTION (hard delete — owner only via RBAC)
// ─────────────────────────────────────────────────────────────────────────

export async function deletePrescription({ record }) {
  requirePerm("medical_record", "delete");
  requireClinicId();
  const { userId } = requireActor();

  if (!record) throw new NotFoundError("Prescription");

  const clinicIdForEvent = record.createdByClinicId
    ? String(record.createdByClinicId)
    : null;
  const recordId = String(record._id);

  await record.deleteOne();

  log.warn(
    { prescriptionId: recordId, deletedBy: String(userId) },
    "Prescription HARD-DELETED — preserved only in audit log",
  );

  eventBus.emitSafe(EVENTS.MEDICAL_PRESCRIPTION_DELETED, {
    prescriptionId: recordId,
    clinicId: clinicIdForEvent,
    deletedBy: String(userId),
  });

  return { prescriptionId: recordId, deleted: true };
}

// ─────────────────────────────────────────────────────────────────────────
//  GET FOR PDF (raw shape, no cross-clinic strip — PDF only for own/doctor)
// ─────────────────────────────────────────────────────────────────────────

export async function getPrescriptionForPdf({ record }) {
  requirePerm("medical_record", "read");
  requireClinicId();
  if (!record) throw new NotFoundError("Prescription");
  return toApiShape(record.toObject ? record.toObject() : record);
}
