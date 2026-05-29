// modules/clinic/clinic-medical/services/imaging.service.js
//
// Imaging study service for clinic-medical. Sprint 2 Phase 2C.2.
//
// ─────────────────────────────────────────────────────────────────────────────
//  WHY HAND-WRITTEN (not via subRecordBase factory)
// ─────────────────────────────────────────────────────────────────────────────
//
// ImagingStudy differs from text sub-records:
//   - has file attachments (image URLs uploaded to R2 by the controller via
//     processFiles middleware — service receives ready URL strings in images[])
//   - uses `patient` legacy field semantics + new `patientId` for clinic-medical
//   - richer field set (studyType, report, diagnosis, contrastUsed)
//   - own validation workflow (validatedByDoctor) — not status machine
//
// But it REUSES the same access-chain rules:
//   1. ownership      — createdByClinicId === currentClinicId
//   2. per-record     — sharedWith includes currentClinicId
//   3. global consent — PatientConsent.checkScope(patientId, clinicId, "imaging")
//
// ─────────────────────────────────────────────────────────────────────────────
//  ⚠️ files[] vs images[] — different things in ImagingStudy
// ─────────────────────────────────────────────────────────────────────────────
//
// The legacy ImagingStudy.files[] is an embedded schema (File.schema) used by
// myClinic flow — every entry is REQUIRED to be linked to a Scan document
// (CTScan/MRIScan/etc) via a `study` ref. Mongoose validator enforces this.
//
// clinic-medical doesn't create Scan documents — it uploads image URLs straight
// into the simple String[] field `images[]`. We must NOT populate `files[]`
// here or Mongoose validation fails with:
//   "ImagingStudy validation failed: files: File must be linked to a study"
//
// Result: controller still extracts file metadata from req.uploadedFiles for
// audit purposes, but service stores ONLY images[] (URL strings). The richer
// `files[]` array stays empty for clinic-medical records.

import ImagingStudy from "../../../../common/models/Polyclinic/MedicalHistory/ImagingStudy.js";
import PatientConsent from "../../../../common/models/Polyclinic/PatientConsent.js";
import {
  NotFoundError,
  ForbiddenError,
  UnprocessableError,
} from "../../../../common/utils/errors.js";
import {
  getCurrentClinicId,
  getCurrentUserId,
  getCurrentActorType,
} from "../../../../common/context/tenantContext.js";
import { require as requirePerm } from "../../../../common/auth/can.js";
import logger from "../../../../common/logger.js";

const log = logger.child({ module: "clinic-medical/imaging" });

const SCOPE = "imaging";

const VALID_STUDY_TYPES = [
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
];

// ─── context helpers ──────────────────────────────────────────────────

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

// ─── response shape ───────────────────────────────────────────────────
//
// Exposes images[] (URL strings) and NOT files[] (legacy myClinic-only
// embedded schema). Controller's uploaded-file metadata isn't echoed back
// — clients can derive what they need from images[].

function toShape(doc) {
  if (!doc) return null;
  return {
    _id: String(doc._id),
    patientId: doc.patientId ? String(doc.patientId) : null,
    studyType: doc.studyType,
    date: doc.date || null,
    images: Array.isArray(doc.images) ? doc.images : [],
    report: doc.report || null,
    diagnosis: doc.diagnosis || null,
    contrastUsed: Boolean(doc.contrastUsed),
    validatedByDoctor: Boolean(doc.validatedByDoctor),
    doctorNotes: doc.doctorNotes || null,

    createdBy: doc.createdBy ? String(doc.createdBy) : null,
    createdByEmployee: doc.createdByEmployee
      ? String(doc.createdByEmployee)
      : null,
    createdByClinicId: doc.createdByClinicId
      ? String(doc.createdByClinicId)
      : null,
    sharedWith: Array.isArray(doc.sharedWith)
      ? doc.sharedWith.map((id) => String(id))
      : [],

    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

// ─── access decision (per record) ─────────────────────────────────────

async function decideRecordAccess(record, clinicId) {
  if (
    record.createdByClinicId &&
    String(record.createdByClinicId) === String(clinicId)
  ) {
    return { granted: true, reason: "ownership", isCrossClinic: false };
  }
  if (Array.isArray(record.sharedWith)) {
    if (record.sharedWith.some((id) => String(id) === String(clinicId))) {
      return { granted: true, reason: "shared_with", isCrossClinic: true };
    }
  }
  if (record.patientId) {
    const allowed = await PatientConsent.checkScope(
      record.patientId,
      clinicId,
      SCOPE,
    );
    if (allowed) {
      return { granted: true, reason: "global_consent", isCrossClinic: true };
    }
  }
  return { granted: false, reason: "denied", isCrossClinic: false };
}

// ─────────────────────────────────────────────────────────────────────────
//  CREATE
// ─────────────────────────────────────────────────────────────────────────
//
// @param patient  — req.clinicPatient (resolved upstream)
// @param body     — { studyType, date, report, diagnosis, contrastUsed }
// @param images   — string[] of uploaded URLs (from controller/processFiles)
// @param files    — IGNORED (kept in signature for backward compat with the
//                   controller; legacy files[] requires a study ref that
//                   clinic-medical doesn't have, so we must not populate it)

export async function createImaging({ patient, body, images = [], files }) {
  // `files` arg intentionally unused — see file header.
  void files;

  requirePerm("medical_record", "write");
  const clinicId = requireClinicId();
  const { userId, actorType } = requireActor();

  if (!patient || !patient._id) {
    throw new UnprocessableError("Patient is required");
  }

  if (!body.studyType || !VALID_STUDY_TYPES.includes(body.studyType)) {
    throw new UnprocessableError(
      `studyType is required and must be one of: ${VALID_STUDY_TYPES.join(", ")}`,
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

  const payload = {
    patientId: patient._id,
    // patient (legacy NewPatientPolyclinic ref) left null — clinic-medical
    // uses patientId. Validator accepts either.
    patient: null,

    studyType: body.studyType,
    date: body.date || new Date(),
    images: Array.isArray(images) ? images : [],
    report: body.report || null,
    diagnosis: body.diagnosis || null,
    contrastUsed: Boolean(body.contrastUsed),
    // files: NOT set — see header comment. Legacy myClinic schema requires
    // every embedded file to link to a Scan document, which we don't create.

    ...authorship,
    sharedWith: Array.isArray(body.sharedWith) ? body.sharedWith : [],
  };

  let doc;
  try {
    doc = new ImagingStudy(payload);
    await doc.save();
  } catch (err) {
    if (
      err.name === "ValidationError" ||
      err.message?.includes("Author is required") ||
      err.message?.includes("Only one author allowed") ||
      err.message?.includes("createdByClinicId is required") ||
      err.message?.includes("Patient is required")
    ) {
      throw new UnprocessableError(err.message);
    }
    throw err;
  }

  log.info(
    {
      imagingId: String(doc._id),
      clinicId: String(clinicId),
      patientId: String(patient._id),
      studyType: body.studyType,
      imageCount: payload.images.length,
      actorType,
    },
    "Imaging study created",
  );

  return toShape(doc.toObject());
}

// ─────────────────────────────────────────────────────────────────────────
//  GET (single)
// ─────────────────────────────────────────────────────────────────────────

export async function getImaging({ recordId }) {
  requirePerm("medical_record", "read");
  const clinicId = requireClinicId();

  const doc = await ImagingStudy.findById(recordId);
  if (!doc) throw new NotFoundError("ImagingStudy");

  const decision = await decideRecordAccess(doc, clinicId);
  if (!decision.granted) {
    throw new ForbiddenError("No access to this imaging study", {
      code: "ACCESS_DENIED",
      scope: SCOPE,
    });
  }

  const shape = toShape(doc.toObject());
  if (decision.isCrossClinic) shape.isCrossClinic = true;
  return shape;
}

// ─────────────────────────────────────────────────────────────────────────
//  LIST (for a patient)
// ─────────────────────────────────────────────────────────────────────────

export async function listImaging({ patient, query = {} }) {
  requirePerm("medical_record", "read");
  const clinicId = requireClinicId();

  if (!patient || !patient._id) {
    throw new UnprocessableError("Patient is required");
  }

  const { limit = 100, before, studyType } = query;

  const hasGlobalConsent = await PatientConsent.checkScope(
    patient._id,
    clinicId,
    SCOPE,
  );

  const accessOr = [{ createdByClinicId: clinicId }, { sharedWith: clinicId }];
  if (hasGlobalConsent) accessOr.push({});

  const filter = {
    patientId: patient._id,
    $or: accessOr,
  };
  if (studyType) filter.studyType = studyType;
  if (before) filter.createdAt = { $lt: before };

  const docs = await ImagingStudy.find(filter)
    .sort({ date: -1, createdAt: -1 })
    .limit(Math.min(limit, 200))
    .lean();

  const items = docs.map((doc) => {
    const shape = toShape(doc);
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
//  UPDATE (owner clinic only)
// ─────────────────────────────────────────────────────────────────────────

export async function updateImaging({ recordId, body }) {
  requirePerm("medical_record", "write");
  const clinicId = requireClinicId();
  const { userId } = requireActor();

  const doc = await ImagingStudy.findById(recordId);
  if (!doc) throw new NotFoundError("ImagingStudy");

  if (
    !doc.createdByClinicId ||
    String(doc.createdByClinicId) !== String(clinicId)
  ) {
    throw new ForbiddenError(
      "Only the clinic that created this imaging study can edit it",
      { code: "NOT_RECORD_OWNER" },
    );
  }

  const editable = ["report", "diagnosis", "doctorNotes"];
  for (const field of editable) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      doc[field] = body[field] || null;
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "contrastUsed")) {
    doc.contrastUsed = Boolean(body.contrastUsed);
  }
  if (Object.prototype.hasOwnProperty.call(body, "validatedByDoctor")) {
    doc.validatedByDoctor = Boolean(body.validatedByDoctor);
  }
  if (Array.isArray(body.sharedWith)) {
    doc.sharedWith = body.sharedWith;
  }

  await doc.save();

  log.info(
    { imagingId: String(doc._id), updatedBy: String(userId) },
    "Imaging study updated",
  );

  return toShape(doc.toObject());
}

// ─────────────────────────────────────────────────────────────────────────
//  DELETE (owner clinic only)
// ─────────────────────────────────────────────────────────────────────────

export async function deleteImaging({ recordId }) {
  requirePerm("medical_record", "delete");
  const clinicId = requireClinicId();
  const { userId } = requireActor();

  const doc = await ImagingStudy.findById(recordId);
  if (!doc) throw new NotFoundError("ImagingStudy");

  if (
    !doc.createdByClinicId ||
    String(doc.createdByClinicId) !== String(clinicId)
  ) {
    throw new ForbiddenError(
      "Only the clinic that created this imaging study can delete it",
      { code: "NOT_RECORD_OWNER" },
    );
  }

  const recordIdStr = String(doc._id);
  const imageUrls = Array.isArray(doc.images) ? [...doc.images] : [];
  await doc.deleteOne();

  log.warn(
    {
      imagingId: recordIdStr,
      deletedBy: String(userId),
      orphanedImages: imageUrls.length,
    },
    "Imaging study deleted — R2 files NOT removed (tech debt: orphan cleanup)",
  );

  return { recordId: recordIdStr, deleted: true, orphanedImages: imageUrls };
}
