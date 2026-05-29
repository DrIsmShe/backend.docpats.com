// modules/clinic/clinic-medical/services/imaging.service.js
//
// (mod 30 May 2026): deleteImaging теперь не просто логгирует orphan files,
// а ставит их в очередь OrphanR2File для cron'а jobs/r2OrphanCleanup.cron.js.
//
// Изменения только в deleteImaging — остальное идентично Sprint 2.

import ImagingStudy from "../../../../common/models/Polyclinic/MedicalHistory/ImagingStudy.js";
import PatientConsent from "../../../../common/models/Polyclinic/PatientConsent.js";
import OrphanR2File from "../../../../common/models/system/OrphanR2File.js";
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

// ─── CREATE ────────────────────────────────────────────────────────────

export async function createImaging({ patient, body, images = [], files }) {
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
    patient: null,
    studyType: body.studyType,
    date: body.date || new Date(),
    images: Array.isArray(images) ? images : [],
    report: body.report || null,
    diagnosis: body.diagnosis || null,
    contrastUsed: Boolean(body.contrastUsed),
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

// ─── GET ───────────────────────────────────────────────────────────────

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

// ─── LIST ──────────────────────────────────────────────────────────────

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

// ─── UPDATE ────────────────────────────────────────────────────────────

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

// ─── DELETE ────────────────────────────────────────────────────────────
//
// (mod 30 May 2026)
// Hard delete документа + постановка images[] в очередь OrphanR2File
// для фонового удаления из R2. См. jobs/r2OrphanCleanup.cron.js.

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

  // Ставим R2 файлы в очередь на удаление. Если БД упадёт здесь —
  // основная операция уже committed (doc удалён), но мы потеряем
  // референс на файлы. Это приемлемо для MVP — будет видно в логах
  // как warning. Альтернатива (transactions) усложнит код без
  // соответствующего выигрыша для cleanup задачи.
  let queuedCount = 0;
  if (imageUrls.length > 0) {
    try {
      const orphanDocs = imageUrls.map((url) => ({
        fileUrl: url,
        sourceModel: "ImagingStudy",
        sourceId: doc._id,
        clinicId,
        deletedAt: new Date(),
      }));
      const inserted = await OrphanR2File.insertMany(orphanDocs, {
        // Не валидируем "ordered" — если одна запись упадёт, остальные пишутся
        ordered: false,
      });
      queuedCount = inserted.length;
    } catch (err) {
      log.error(
        {
          err,
          imagingId: recordIdStr,
          urlCount: imageUrls.length,
        },
        "Failed to enqueue orphan R2 files — manual cleanup needed",
      );
      // НЕ throw — основная операция (delete) уже прошла успешно.
      // Падение очереди — это deferred problem, не должно фейлить запрос.
    }
  }

  log.info(
    {
      imagingId: recordIdStr,
      deletedBy: String(userId),
      orphanedImages: imageUrls.length,
      queuedForCleanup: queuedCount,
    },
    "Imaging study deleted",
  );

  return {
    recordId: recordIdStr,
    deleted: true,
    orphanedImages: imageUrls,
    queuedForCleanup: queuedCount,
  };
}
