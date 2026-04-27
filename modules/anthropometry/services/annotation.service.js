import PatientCase from "../models/PatientCase.model.js";
import Study from "../models/Study.model.js";
import Photo from "../models/Photo.model.js";
import Annotation from "../models/Annotation.model.js";
import auditService from "./audit.service.js";
import measurementService from "./measurement.service.js";
import { withTransaction } from "../../../common/utils/db.js";
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
  ConflictError,
  PreconditionError,
} from "../utils/errors.js";
import mongoose from "mongoose";

/* ============================================================
   PRIVATE HELPERS
   ============================================================ */

const getAnnotationWithAccess = async (annotationId, actor, session) => {
  const query = Annotation.findOne({ _id: annotationId, isDeleted: false });
  if (session) query.session(session);
  const annotation = await query.exec();
  if (!annotation) throw new NotFoundError("Annotation", annotationId);
  if (String(annotation.doctorUserId) !== String(actor.userId)) {
    throw new ForbiddenError(
      "annotation access",
      "annotation belongs to another doctor",
    );
  }
  return annotation;
};

const getPhotoForAnnotation = async (photoId, actor, session) => {
  const query = Photo.findOneActive({ _id: photoId });
  if (session) query.session(session);
  const photo = await query.exec();
  if (!photo) throw new NotFoundError("Photo", photoId);
  if (String(photo.doctorUserId) !== String(actor.userId)) {
    throw new ForbiddenError("photo access", "photo belongs to another doctor");
  }
  if (!photo.isReady()) {
    throw new PreconditionError("Photo is not ready for annotation", {
      status: photo.status,
    });
  }
  return photo;
};

const getStudyForPhoto = async (studyId, session) => {
  const query = Study.findOneActive({ _id: studyId });
  if (session) query.session(session);
  const study = await query.exec();
  if (!study) throw new NotFoundError("Study", studyId);
  return study;
};

const validateLandmarks = (landmarks) => {
  if (!Array.isArray(landmarks)) {
    throw new ValidationError("landmarks must be an array");
  }
  for (const lm of landmarks) {
    if (!lm.id || typeof lm.id !== "string") {
      throw new ValidationError("each landmark must have string id");
    }
    if (typeof lm.x !== "number" || typeof lm.y !== "number") {
      throw new ValidationError(`landmark ${lm.id} must have numeric x and y`);
    }
    if (lm.x < 0 || lm.x > 1 || lm.y < 0 || lm.y > 1) {
      throw new ValidationError(`landmark ${lm.id} coordinates must be 0..1`);
    }
  }
};

/**
 * Достаёт gender пациента через цепочку Annotation→Photo→Study→Case→Patient.
 * Используется для gender-specific норм measurements.
 */
const resolvePatientGender = async (caseId, session) => {
  const query = PatientCase.findOne({ _id: caseId });
  if (session) query.session(session);
  const caseDoc = await query.exec();
  if (!caseDoc) return "unknown";

  const PatientModel = mongoose.model(
    caseDoc.patientType === "registered"
      ? "NewPatientPolyclinic"
      : "DoctorPrivatePatient",
  );
  const patientId =
    caseDoc.patientType === "registered"
      ? caseDoc.registeredPatientId
      : caseDoc.privatePatientId;

  const patient = await PatientModel.findById(patientId)
    .select("gender")
    .lean();
  return patient?.gender || "unknown";
};

/* ============================================================
   CREATE ANNOTATION (v1)
   ============================================================ */

export const createAnnotation = async (params) => {
  const { photoId, presetType, landmarks, description, actor, context } =
    params;

  if (!presetType) throw new ValidationError("presetType is required");
  validateLandmarks(landmarks || []);

  const photo = await getPhotoForAnnotation(photoId, actor);
  const study = await getStudyForPhoto(photo.studyId);

  // Проверка что нет уже актуальной аннотации для этого фото+presetType
  const existing = await Annotation.findCurrent(photo._id, presetType);
  if (existing) {
    throw new ConflictError(
      "Annotation already exists for this photo and preset. Use createNewVersion to update.",
      { existingAnnotationId: String(existing._id), version: existing.version },
    );
  }

  // Получаем gender для gender-specific норм
  const patientGender = await resolvePatientGender(photo.caseId);

  // Вычисляем measurements
  const computeResult = measurementService.computeMeasurements({
    landmarks,
    presetType,
    photo,
    study,
    patientGender,
  });

  const annotation = new Annotation({
    photoId: photo._id,
    studyId: photo.studyId,
    caseId: photo.caseId,
    doctorUserId: actor.userId,
    presetType,
    presetVersion: computeResult.presetVersion,
    version: 1,
    parentVersion: null,
    isCurrent: true,
    isLocked: false,
    landmarks,
    measurements: computeResult.measurements,
    description,
    createdBy: actor.userId,
  });

  await annotation.save();

  await auditService.recordAction({
    actor,
    context,
    action: "annotation.create",
    resourceType: "Annotation",
    resourceId: annotation._id,
    caseId: annotation.caseId,
    metadata: {
      presetType,
      landmarksCount: landmarks.length,
      measurementsCount: computeResult.measurements.length,
      skippedMeasurements: computeResult.skipped.length,
      hasCalibration: computeResult.hasCalibration,
    },
  });

  return { annotation, computeResult };
};

/* ============================================================
   GET ANNOTATION
   ============================================================ */

export const getAnnotation = async (params) => {
  const { annotationId, actor, context } = params;
  const annotation = await getAnnotationWithAccess(annotationId, actor);

  auditService.recordActionAsync({
    actor,
    context,
    action: "annotation.view",
    resourceType: "Annotation",
    resourceId: annotation._id,
    caseId: annotation.caseId,
  });

  return annotation;
};

export const getCurrentForPhoto = async (params) => {
  const { photoId, presetType, actor } = params;
  const photo = await getPhotoForAnnotation(photoId, actor);
  return Annotation.findCurrent(photo._id, presetType);
};

/* ============================================================
   GET HISTORY
   ============================================================ */

export const getHistory = async (params) => {
  const { photoId, presetType, actor } = params;
  const photo = await getPhotoForAnnotation(photoId, actor);
  return Annotation.findHistory(photo._id, presetType);
};

/* ============================================================
   UPDATE LANDMARKS (in-place edit, only if not locked)
   ============================================================ */

export const updateLandmarks = async (params) => {
  const { annotationId, landmarks, actor, context } = params;

  validateLandmarks(landmarks);

  const annotation = await getAnnotationWithAccess(annotationId, actor);

  if (!annotation.isEditable()) {
    throw new ConflictError("Annotation is not editable", {
      isLocked: annotation.isLocked,
      isCurrent: annotation.isCurrent,
    });
  }

  const photo = await Photo.findOne({ _id: annotation.photoId });
  const study = await Study.findOne({ _id: annotation.studyId });
  const patientGender = await resolvePatientGender(annotation.caseId);

  const computeResult = measurementService.computeMeasurements({
    landmarks,
    presetType: annotation.presetType,
    photo,
    study,
    patientGender,
  });

  annotation.landmarks = landmarks;
  annotation.measurements = computeResult.measurements;
  annotation.updatedBy = actor.userId;
  await annotation.save();

  await auditService.recordAction({
    actor,
    context,
    action: "annotation.update",
    resourceType: "Annotation",
    resourceId: annotation._id,
    caseId: annotation.caseId,
    metadata: {
      landmarksCount: landmarks.length,
      measurementsCount: computeResult.measurements.length,
    },
  });

  return { annotation, computeResult };
};

/* ============================================================
   CREATE NEW VERSION (TRANSACTIONAL)
   ============================================================
   Создаёт новую версию аннотации.

   Атомарно:
     1. Снимает isCurrent с предыдущей версии
     2. Создаёт новую запись с version+1, parentVersion=prev._id
     3. Audit log */

export const createNewVersion = async (params) => {
  const { photoId, presetType, landmarks, description, actor, context } =
    params;

  validateLandmarks(landmarks || []);

  return withTransaction(async (session) => {
    const photo = await getPhotoForAnnotation(photoId, actor, session);
    const study = await getStudyForPhoto(photo.studyId, session);

    // Получаем текущую версию (она станет parent)
    const previousQuery = Annotation.findCurrent(photo._id, presetType);
    previousQuery.session(session);
    const previous = await previousQuery.exec();

    if (!previous) {
      throw new ConflictError(
        "No current annotation exists. Use createAnnotation for first version.",
      );
    }

    const patientGender = await resolvePatientGender(photo.caseId, session);

    const computeResult = measurementService.computeMeasurements({
      landmarks,
      presetType,
      photo,
      study,
      patientGender,
    });

    // Снимаем флаг с предыдущей версии
    previous.isCurrent = false;
    previous.updatedBy = actor.userId;
    await previous.save({ session });

    // Создаём новую версию
    const newVersionDoc = {
      photoId: photo._id,
      studyId: photo.studyId,
      caseId: photo.caseId,
      doctorUserId: actor.userId,
      presetType,
      presetVersion: computeResult.presetVersion,
      version: previous.version + 1,
      parentVersion: previous._id,
      isCurrent: true,
      isLocked: false,
      landmarks,
      measurements: computeResult.measurements,
      description,
      createdBy: actor.userId,
    };

    const created = await Annotation.create([newVersionDoc], { session });
    const annotation = created[0];

    await auditService.recordAction({
      actor,
      context,
      action: "annotation.create_version",
      resourceType: "Annotation",
      resourceId: annotation._id,
      caseId: annotation.caseId,
      metadata: {
        fromVersion: previous.version,
        toVersion: annotation.version,
        parentAnnotationId: String(previous._id),
        landmarksCount: landmarks.length,
        measurementsCount: computeResult.measurements.length,
      },
      session,
    });

    return { annotation, previousVersion: previous, computeResult };
  });
};

/* ============================================================
   LOCK / UNLOCK ANNOTATION
   ============================================================ */

export const lockAnnotation = async (params) => {
  const { annotationId, actor, context, reason } = params;

  const annotation = await getAnnotationWithAccess(annotationId, actor);

  if (annotation.isLocked) {
    throw new ConflictError("Annotation already locked");
  }
  if (!annotation.isCurrent) {
    throw new ConflictError("Cannot lock non-current annotation");
  }

  annotation.isLocked = true;
  annotation.lockedBy = actor.userId;
  annotation.lockReason = reason;
  // lockedAt проставится через pre-save хук модели
  await annotation.save();

  await auditService.recordAction({
    actor,
    context,
    action: "annotation.lock",
    resourceType: "Annotation",
    resourceId: annotation._id,
    caseId: annotation.caseId,
    metadata: { reason },
  });

  return annotation;
};

export const unlockAnnotation = async (params) => {
  const { annotationId, actor, context, reason } = params;

  if (!reason || reason.trim().length < 10) {
    throw new ValidationError(
      "Unlock requires reason with at least 10 characters (audit requirement)",
    );
  }

  const annotation = await getAnnotationWithAccess(annotationId, actor);

  if (!annotation.isLocked) {
    throw new ConflictError("Annotation is not locked");
  }

  annotation.isLocked = false;
  annotation.lockedBy = undefined;
  annotation.lockedAt = undefined;
  annotation.lockReason = undefined;
  annotation.updatedBy = actor.userId;
  await annotation.save();

  await auditService.recordAction({
    actor,
    context,
    action: "annotation.unlock",
    resourceType: "Annotation",
    resourceId: annotation._id,
    caseId: annotation.caseId,
    metadata: { reason },
  });

  return annotation;
};

/* ============================================================
   SOFT DELETE ANNOTATION
   ============================================================ */

export const softDeleteAnnotation = async (params) => {
  const { annotationId, actor, context, reason } = params;

  const annotation = await getAnnotationWithAccess(annotationId, actor);

  if (annotation.isLocked) {
    throw new ConflictError("Cannot delete locked annotation. Unlock first.");
  }

  annotation.isDeleted = true;
  annotation.deletedAt = new Date();
  annotation.deletedBy = actor.userId;
  annotation.isCurrent = false;
  await annotation.save();

  await auditService.recordAction({
    actor,
    context,
    action: "annotation.delete",
    resourceType: "Annotation",
    resourceId: annotation._id,
    caseId: annotation.caseId,
    metadata: { reason },
  });

  return annotation;
};

/* ============================================================
   DEFAULT EXPORT
   ============================================================ */

export default {
  createAnnotation,
  getAnnotation,
  getCurrentForPhoto,
  getHistory,
  updateLandmarks,
  createNewVersion,
  lockAnnotation,
  unlockAnnotation,
  softDeleteAnnotation,
};
