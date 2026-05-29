// modules/clinic/clinic-medical/services/medicalHistory.service.js
//
// Business logic for clinic-medical encounters (newPatientMedicalHistory).
// Sprint 2 Phase 2B.
//
// ─────────────────────────────────────────────────────────────────────────────
//  ARCHITECTURE
// ─────────────────────────────────────────────────────────────────────────────
//
// 1. tenantContext provides clinicId + userId + actorType.
// 2. Permission gate via require("medical_record", "<action>") — coarse.
// 3. Fine-grained RBAC is enforced at MIDDLEWARE layer (Phase 2A).
//    Service trusts that if it was called, fine-grained passed.
// 4. Access decisions for READ live in checkConsent middleware which
//    sets req.consentDecision — service receives decisions, doesn't make them.
// 5. Status machine — strict transitions only via signEncounter() and
//    amendEncounter(). Generic updateEncounter() is locked to draft only.
// 6. Audit log is written via auditMiddleware on routes. Service emits
//    domain events; controllers may add audit metadata.
//
// ─────────────────────────────────────────────────────────────────────────────
//  STATUS MACHINE
// ─────────────────────────────────────────────────────────────────────────────
//
//   draft ──signEncounter()──> signed ──amendEncounter()──> amended
//     │
//     └── updateEncounter() allowed (in-place edits)
//
//   signed / amended encounters are CONTENT-IMMUTABLE except via amendEncounter
//   which preserves audit trail.
//
// "preliminary" status reserved for future Phase 3 (resident workflow:
//   resident creates "preliminary" → attending doctor signs).
//   Not currently produced by any endpoint.

import NewPatientMedicalHistory from "../../../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";
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

const log = logger.child({ module: "clinic-medical/service" });

// ─── helpers ──────────────────────────────────────────────────────────

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
 * Convert encounter document into API response shape.
 * Encounter does NOT carry encrypted PHI fields at storage layer
 * (text fields are stored as plaintext per current design — encryption
 * planned for US/EU rollout). Sub-doc mainDiagnosis is structured;
 * legacy diagnosis is mirrored from mainDiagnosis.text via pre-save hook.
 */
function toApiShape(doc) {
  if (!doc) return null;
  return {
    _id: String(doc._id),
    status: doc.status,
    patientType: doc.patientType,
    patientTypeModel: doc.patientTypeModel,
    patientRef: doc.patientRef ? String(doc.patientRef) : null,

    // Authorship (UMR)
    createdBy: doc.createdBy ? String(doc.createdBy) : null,
    createdByEmployee: doc.createdByEmployee
      ? String(doc.createdByEmployee)
      : null,
    createdByClinicId: doc.createdByClinicId
      ? String(doc.createdByClinicId)
      : null,

    // Signing
    signedByUserId: doc.signedByUserId ? String(doc.signedByUserId) : null,
    signedByEmployeeId: doc.signedByEmployeeId
      ? String(doc.signedByEmployeeId)
      : null,
    signedAt: doc.signedAt || null,

    // Consent
    sharedWith: Array.isArray(doc.sharedWith)
      ? doc.sharedWith.map((id) => String(id))
      : [],

    // Diagnosis
    mainDiagnosis: doc.mainDiagnosis
      ? {
          code: doc.mainDiagnosis.code || "",
          codeTitle: doc.mainDiagnosis.codeTitle || "",
          text: doc.mainDiagnosis.text || "",
        }
      : null,
    additionalDiagnosis: doc.additionalDiagnosis || null,

    // Content
    complaints: doc.complaints || null,
    anamnesisMorbi: doc.anamnesisMorbi || null,
    anamnesisVitae: doc.anamnesisVitae || null,
    statusPreasens: doc.statusPreasens || null,
    statusLocalis: doc.statusLocalis || null,
    recommendations: doc.recommendations || null,
    ctScanResults: doc.ctScanResults || null,
    mriResults: doc.mriResults || null,
    ultrasoundResults: doc.ultrasoundResults || null,
    laboratoryTestResults: doc.laboratoryTestResults || null,

    // Audit
    history: Array.isArray(doc.history) ? doc.history : [],

    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Strip PHI from response for cross-clinic reads where the requesting
 * clinic has consent but record was created by a different clinic.
 * Receptionist/manager-style roles also get this filtered shape.
 *
 * Caller passes consentDecision from middleware. If isCrossClinic=true
 * and role is not doctor/owner/admin, we hide free-text PHI fields.
 */
function filterCrossClinicShape(shape, consentDecision, role) {
  if (!consentDecision?.isCrossClinic) return shape;
  if (["doctor", "owner", "admin"].includes(role)) return shape;

  // Drop free-text PHI — keep structured metadata only
  return {
    ...shape,
    complaints: null,
    anamnesisMorbi: null,
    anamnesisVitae: null,
    statusPreasens: null,
    statusLocalis: null,
    recommendations: null,
    ctScanResults: null,
    mriResults: null,
    ultrasoundResults: null,
    laboratoryTestResults: null,
    additionalDiagnosis: null,
    // mainDiagnosis structured ICD-10 code+text is kept (it's the
    // referral payload — what's the patient being treated for).
  };
}

// ─────────────────────────────────────────────────────────────────────────
//  CREATE ENCOUNTER
// ─────────────────────────────────────────────────────────────────────────
//
// Creates encounter under a clinic patient. The actor is either a
// User (doctor with DocPats account) or a ClinicEmployee (internal).
//
// status:
//   - "draft": mainDiagnosis optional, no signing
//   - "signed": mainDiagnosis required, signedAt/By set
//
// patient: must be req.clinicPatient (resolved upstream). We pass its
// ObjectId as patientRef and "ClinicPatient" as patientTypeModel.

export async function createEncounter({ patient, body }) {
  requirePerm("medical_record", "write");
  const clinicId = requireClinicId();
  const { userId, actorType } = requireActor();

  if (!patient || !patient._id) {
    throw new UnprocessableError("Patient is required");
  }

  const now = new Date();
  const status = body.status || "signed";

  // Build authorship fields based on actorType
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

  // Signing fields — only for status='signed'
  const signing =
    status === "signed"
      ? {
          signedAt: now,
          signedByUserId: actorType === "user" ? userId : null,
          signedByEmployeeId: actorType === "employee" ? userId : null,
        }
      : {
          signedAt: null,
          signedByUserId: null,
          signedByEmployeeId: null,
        };

  // mainDiagnosis: normalize undefined → empty subdoc (model sub-doc default)
  const mainDiagnosis = body.mainDiagnosis
    ? {
        code: body.mainDiagnosis.code.trim(),
        codeTitle: (body.mainDiagnosis.codeTitle || "").trim(),
        text: body.mainDiagnosis.text.trim(),
      }
    : { code: "", codeTitle: "", text: "" };

  const docPayload = {
    // Patient link
    patientType: "registered", // clinic-medical works only with registered (ClinicPatient)
    patientTypeModel: "ClinicPatient",
    patientRef: patient._id,

    // Status + authorship + signing
    status,
    ...authorship,
    ...signing,

    // Consent / sharing
    sharedWith: Array.isArray(body.sharedWith) ? body.sharedWith : [],

    // Diagnosis
    mainDiagnosis,
    additionalDiagnosis: body.additionalDiagnosis || null,

    // Content (all optional)
    complaints: body.complaints || null,
    anamnesisMorbi: body.anamnesisMorbi || null,
    anamnesisVitae: body.anamnesisVitae || null,
    statusPreasens: body.statusPreasens || null,
    statusLocalis: body.statusLocalis || null,
    recommendations: body.recommendations || null,
    ctScanResults: body.ctScanResults || null,
    mriResults: body.mriResults || null,
    ultrasoundResults: body.ultrasoundResults || null,
    laboratoryTestResults: body.laboratoryTestResults || null,

    // Metadata (legacy)
    metaDescription: body.metaDescription || null,
    metaKeywords: body.metaKeywords || null,
    readTime: body.readTime || 0,
  };

  let encounter;
  try {
    encounter = new NewPatientMedicalHistory(docPayload);
    await encounter.save();
  } catch (err) {
    // Surface UMR validator errors as 400 (controller handles AppError → status)
    if (
      err.name === "ValidationError" ||
      err.message?.includes("Author is required") ||
      err.message?.includes("Only one author allowed") ||
      err.message?.includes("createdByClinicId is required") ||
      err.message?.includes("Signed/amended records require")
    ) {
      throw new UnprocessableError(err.message);
    }
    throw err;
  }

  log.info(
    {
      encounterId: String(encounter._id),
      clinicId: String(clinicId),
      patientId: String(patient._id),
      status,
      actorType,
    },
    "Encounter created",
  );

  eventBus.emitSafe(EVENTS.MEDICAL_ENCOUNTER_CREATED, {
    encounterId: String(encounter._id),
    clinicId: String(clinicId),
    patientId: String(patient._id),
    status,
    createdBy: String(userId),
    actorType,
  });

  return toApiShape(encounter.toObject());
}

// ─────────────────────────────────────────────────────────────────────────
//  GET ENCOUNTER (single, by ID)
// ─────────────────────────────────────────────────────────────────────────
//
// Returns single encounter shape. Cross-clinic PHI filtering is applied
// based on consentDecision from middleware.

export async function getEncounter({ record, consentDecision, role }) {
  requirePerm("medical_record", "read");
  requireClinicId();

  if (!record) throw new NotFoundError("Encounter");

  const shape = toApiShape(record.toObject ? record.toObject() : record);
  return filterCrossClinicShape(shape, consentDecision, role);
}

// ─────────────────────────────────────────────────────────────────────────
//  LIST ENCOUNTERS
// ─────────────────────────────────────────────────────────────────────────
//
// Lists encounters for a specific patient. Filters by ACCESS CHAIN:
//   - own clinic's encounters (createdByClinicId === currentClinicId)
//   - encounters shared with this clinic (sharedWith includes currentClinicId)
//   - encounters covered by global consent (PatientConsent.encounters=true)
//
// Cursor-based pagination using createdAt.

export async function listEncountersForPatient({ patient, query }) {
  requirePerm("medical_record", "read");
  const clinicId = requireClinicId();

  if (!patient || !patient._id) {
    throw new UnprocessableError("Patient is required");
  }

  const { limit = 50, before, status } = query || {};

  // Check global consent for this patient's encounters
  const hasGlobalConsent = await PatientConsent.checkScope(
    patient._id,
    clinicId,
    "encounters",
  );

  // Build $or filter combining all 3 access paths
  const accessOr = [{ createdByClinicId: clinicId }, { sharedWith: clinicId }];
  if (hasGlobalConsent) {
    // If we have global consent, no additional filter needed for that path
    // — just include all encounters of this patient. Push a permissive
    // clause to the OR.
    accessOr.push({}); // matches any record on patientRef
  }

  const filter = {
    patientRef: patient._id,
    patientTypeModel: "ClinicPatient",
    $or: accessOr,
  };

  if (status) filter.status = status;
  if (before) filter.createdAt = { $lt: before };

  const docs = await NewPatientMedicalHistory.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 100))
    .lean();

  const items = docs.map((doc) => {
    const shape = toApiShape(doc);
    const isCrossClinic =
      !doc.createdByClinicId ||
      String(doc.createdByClinicId) !== String(clinicId);
    // Note: per-record sharedWith ALSO counts as cross-clinic-ish for
    // PHI filtering purposes — the data was originally entered by
    // another clinic.
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
//  UPDATE ENCOUNTER (in-place edit of DRAFT)
// ─────────────────────────────────────────────────────────────────────────
//
// Only DRAFT encounters can be updated. signed/amended are immutable —
// use amendEncounter() instead.

export async function updateEncounter({ record, body }) {
  requirePerm("medical_record", "write");
  requireClinicId();
  const { userId } = requireActor();

  if (!record) throw new NotFoundError("Encounter");

  if (record.status !== "draft") {
    throw new ConflictError(
      `Cannot update encounter in status='${record.status}'. Only drafts can be edited. Use amend endpoint for signed encounters.`,
      { code: "ENCOUNTER_NOT_EDITABLE", currentStatus: record.status },
    );
  }

  // Apply only present fields
  const editable = [
    "complaints",
    "anamnesisMorbi",
    "anamnesisVitae",
    "statusPreasens",
    "statusLocalis",
    "recommendations",
    "ctScanResults",
    "mriResults",
    "ultrasoundResults",
    "laboratoryTestResults",
    "additionalDiagnosis",
  ];

  for (const field of editable) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      record[field] = body[field] || null;
    }
  }

  if (body.mainDiagnosis) {
    record.mainDiagnosis = {
      code: body.mainDiagnosis.code.trim(),
      codeTitle: (body.mainDiagnosis.codeTitle || "").trim(),
      text: body.mainDiagnosis.text.trim(),
    };
  }

  if (Array.isArray(body.sharedWith)) {
    record.sharedWith = body.sharedWith;
  }

  // Append to history audit array
  record.history.push({
    updatedBy: userId,
    updatedAt: new Date(),
    changes: { field: "draft_update", oldValue: null, newValue: null },
  });

  await record.save();

  eventBus.emitSafe(EVENTS.MEDICAL_ENCOUNTER_UPDATED, {
    encounterId: String(record._id),
    clinicId: String(record.createdByClinicId),
    updatedBy: String(userId),
  });

  return toApiShape(record.toObject());
}

// ─────────────────────────────────────────────────────────────────────────
//  SIGN ENCOUNTER (draft → signed)
// ─────────────────────────────────────────────────────────────────────────

export async function signEncounter({ record, body = {} }) {
  requirePerm("medical_record", "write");
  requireClinicId();
  const { userId, actorType } = requireActor();

  if (!record) throw new NotFoundError("Encounter");

  if (record.status !== "draft") {
    throw new ConflictError(
      `Cannot sign encounter in status='${record.status}'. Only drafts can be signed.`,
      { code: "INVALID_STATUS_TRANSITION", currentStatus: record.status },
    );
  }

  // Apply diagnosis if supplied at signing time
  if (body.mainDiagnosis) {
    record.mainDiagnosis = {
      code: body.mainDiagnosis.code.trim(),
      codeTitle: (body.mainDiagnosis.codeTitle || "").trim(),
      text: body.mainDiagnosis.text.trim(),
    };
  }
  if (body.additionalDiagnosis !== undefined) {
    record.additionalDiagnosis = body.additionalDiagnosis || null;
  }
  if (body.recommendations !== undefined) {
    record.recommendations = body.recommendations || null;
  }

  // Diagnosis must exist now
  if (
    !record.mainDiagnosis?.code?.trim() ||
    !record.mainDiagnosis?.text?.trim()
  ) {
    throw new UnprocessableError(
      "Cannot sign: mainDiagnosis (ICD-10 code + text) is required",
    );
  }

  // Transition
  const now = new Date();
  record.status = "signed";
  record.signedAt = now;
  if (actorType === "user") {
    record.signedByUserId = userId;
    record.signedByEmployeeId = null;
  } else {
    record.signedByEmployeeId = userId;
    record.signedByUserId = null;
  }

  record.history.push({
    updatedBy: userId,
    updatedAt: now,
    changes: { field: "status", oldValue: "draft", newValue: "signed" },
  });

  await record.save();

  log.info(
    { encounterId: String(record._id), signedBy: String(userId), actorType },
    "Encounter signed",
  );

  eventBus.emitSafe(EVENTS.MEDICAL_ENCOUNTER_SIGNED, {
    encounterId: String(record._id),
    clinicId: String(record.createdByClinicId),
    signedBy: String(userId),
    actorType,
  });

  return toApiShape(record.toObject());
}

// ─────────────────────────────────────────────────────────────────────────
//  AMEND ENCOUNTER (signed → amended)
// ─────────────────────────────────────────────────────────────────────────
//
// Correction of a signed encounter. Original values are preserved in
// history[] array. After amendment status becomes "amended" — further
// changes also amend (status stays "amended", history grows).

export async function amendEncounter({ record, body }) {
  requirePerm("medical_record", "write");
  requireClinicId();
  const { userId } = requireActor();

  if (!record) throw new NotFoundError("Encounter");

  if (!["signed", "amended"].includes(record.status)) {
    throw new ConflictError(
      `Cannot amend encounter in status='${record.status}'. Only signed/amended encounters can be amended.`,
      { code: "INVALID_STATUS_TRANSITION", currentStatus: record.status },
    );
  }

  if (!body.reason || body.reason.length < 5) {
    throw new UnprocessableError(
      "Amendment reason is required (min 5 characters)",
    );
  }

  // Track changes in history[] before applying
  const now = new Date();
  const editable = [
    "complaints",
    "anamnesisMorbi",
    "anamnesisVitae",
    "statusPreasens",
    "statusLocalis",
    "recommendations",
    "ctScanResults",
    "mriResults",
    "ultrasoundResults",
    "laboratoryTestResults",
    "additionalDiagnosis",
  ];

  for (const field of editable) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      const oldValue = record[field];
      const newValue = body[field] || null;
      if (oldValue !== newValue) {
        record.history.push({
          updatedBy: userId,
          updatedAt: now,
          changes: { field, oldValue, newValue },
        });
        record[field] = newValue;
      }
    }
  }

  if (body.mainDiagnosis) {
    const oldDx = {
      ...(record.mainDiagnosis?.toObject?.() || record.mainDiagnosis),
    };
    const newDx = {
      code: body.mainDiagnosis.code.trim(),
      codeTitle: (body.mainDiagnosis.codeTitle || "").trim(),
      text: body.mainDiagnosis.text.trim(),
    };
    if (JSON.stringify(oldDx) !== JSON.stringify(newDx)) {
      record.history.push({
        updatedBy: userId,
        updatedAt: now,
        changes: { field: "mainDiagnosis", oldValue: oldDx, newValue: newDx },
      });
      record.mainDiagnosis = newDx;
    }
  }

  // Always log the amendment event itself with reason
  record.history.push({
    updatedBy: userId,
    updatedAt: now,
    changes: {
      field: "_amendment_reason",
      oldValue: null,
      newValue: body.reason,
    },
  });

  record.status = "amended";

  await record.save();

  log.info(
    { encounterId: String(record._id), amendedBy: String(userId) },
    "Encounter amended",
  );

  eventBus.emitSafe(EVENTS.MEDICAL_ENCOUNTER_AMENDED, {
    encounterId: String(record._id),
    clinicId: String(record.createdByClinicId),
    amendedBy: String(userId),
    reason: body.reason,
  });

  return toApiShape(record.toObject());
}

// ─────────────────────────────────────────────────────────────────────────
//  DELETE ENCOUNTER (hard delete — owner only via RBAC)
// ─────────────────────────────────────────────────────────────────────────
//
// We don't have softDelete plugin on newPatientMedicalHistory model.
// For now: hard delete with audit trail. If business requires soft
// delete later — add isDeleted+deletedAt fields to the model.

export async function deleteEncounter({ record }) {
  requirePerm("medical_record", "delete");
  requireClinicId();
  const { userId } = requireActor();

  if (!record) throw new NotFoundError("Encounter");

  const clinicIdForEvent = record.createdByClinicId
    ? String(record.createdByClinicId)
    : null;
  const recordId = String(record._id);

  await record.deleteOne();

  log.warn(
    { encounterId: recordId, deletedBy: String(userId) },
    "Encounter HARD-DELETED — preserved only in audit log",
  );

  eventBus.emitSafe(EVENTS.MEDICAL_ENCOUNTER_DELETED, {
    encounterId: recordId,
    clinicId: clinicIdForEvent,
    deletedBy: String(userId),
  });

  return { encounterId: recordId, deleted: true };
}
