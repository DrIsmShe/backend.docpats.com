// server/modules/anthropometry/services/study.service.js
import PatientCase from "../models/PatientCase.model.js";
import Study from "../models/Study.model.js";
import auditService from "./audit.service.js";
import { withTransaction } from "../../../common/utils/db.js";
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
  ConflictError,
} from "../utils/errors.js";
import photoService from "./photo.service.js";

/* ============================================================
   PRIVATE HELPERS
   ============================================================ */

/**
 * Получает case по id с проверкой существования и доступа.
 * Используется при создании study (нужно знать parent).
 */
const getCaseForStudy = async (caseId, actor, session) => {
  const query = PatientCase.findOneActive({ _id: caseId });
  if (session) query.session(session);
  const caseDoc = await query.exec();

  if (!caseDoc) {
    throw new NotFoundError("PatientCase", caseId);
  }
  if (String(caseDoc.doctorUserId) !== String(actor.userId)) {
    throw new ForbiddenError(
      "case access for study creation",
      "case belongs to another doctor",
    );
  }
  if (caseDoc.isArchived) {
    throw new ConflictError("Cannot add studies to archived case");
  }
  return caseDoc;
};

/**
 * Проверка доступа к study через ownership case.
 * Study принадлежит case, который принадлежит врачу.
 */
const assertStudyAccess = (studyDoc, actor) => {
  if (String(studyDoc.doctorUserId) !== String(actor.userId)) {
    throw new ForbiddenError("study access", "study belongs to another doctor");
  }
};

const assertStudyEditable = (studyDoc) => {
  if (studyDoc.isDeleted) {
    throw new ConflictError("Cannot modify deleted study");
  }
  if (studyDoc.isArchived) {
    throw new ConflictError("Cannot modify archived study");
  }
  if (studyDoc.status === "completed") {
    throw new ConflictError("Cannot modify completed study");
  }
};

/* ============================================================
   CREATE STUDY
   ============================================================ */

/**
 * Создание новой фотосессии в рамках case.
 *
 * @param {Object} params
 * @param {String} params.caseId      — родительский случай
 * @param {Object} params.actor
 * @param {Object} params.context
 * @param {Object} params.data
 * @param {Date}   params.data.studyDate
 * @param {String} params.data.studyType
 * @param {String} [params.data.notes]
 */
export const createStudy = async (params) => {
  const { caseId, actor, context, data } = params;

  if (!data?.studyDate) {
    throw new ValidationError("studyDate is required");
  }
  if (!data.studyType) {
    throw new ValidationError("studyType is required");
  }

  // Проверяем что case существует и доступен
  const caseDoc = await getCaseForStudy(caseId, actor);

  const study = new Study({
    caseId: caseDoc._id,
    doctorUserId: actor.userId,
    studyDate: data.studyDate,
    studyType: data.studyType,
    status: "draft",
    createdBy: actor.userId,
  });

  if (data.notes) {
    study.notes = data.notes; // virtual setter — auto-encrypt
  }

  await study.save();

  // Создание study — non-critical event, fire-and-forget
  auditService.recordActionAsync({
    actor,
    context,
    action: "study.create",
    resourceType: "Study",
    resourceId: study._id,
    caseId: caseDoc._id,
    metadata: {
      studyType: study.studyType,
      studyDate: study.studyDate,
    },
  });

  return study;
};

/* ============================================================
   GET STUDY
   ============================================================ */

export const getStudy = async (params) => {
  const { studyId, actor, context } = params;

  const study = await Study.findOneActive({ _id: studyId });
  if (!study) {
    throw new NotFoundError("Study", studyId);
  }

  try {
    assertStudyAccess(study, actor);
  } catch (err) {
    auditService.recordActionAsync({
      actor,
      context,
      action: "study.view",
      resourceType: "Study",
      resourceId: studyId,
      outcome: "denied",
      failureReason: err.message,
    });
    throw err;
  }

  auditService.recordActionAsync({
    actor,
    context,
    action: "study.view",
    resourceType: "Study",
    resourceId: study._id,
    caseId: study.caseId,
  });

  return study;
};

/* ============================================================
   LIST STUDIES BY CASE
   ============================================================ */

/**
 * Хронологический список фотосессий случая.
 *
 * @param {Object} params
 * @param {String} params.caseId
 * @param {Object} params.actor
 * @param {Object} [params.options] — { includeArchived }
 */
export const listStudiesByCase = async (params) => {
  const { caseId, actor, options = {} } = params;
  const { includeArchived = false } = options;

  // Валидируем доступ к родительскому case
  const caseDoc = await PatientCase.findOneActive({ _id: caseId });
  if (!caseDoc) {
    throw new NotFoundError("PatientCase", caseId);
  }
  if (String(caseDoc.doctorUserId) !== String(actor.userId)) {
    throw new ForbiddenError("studies list", "case belongs to another doctor");
  }

  const filter = { caseId, isDeleted: false };
  if (!includeArchived) filter.isArchived = false;

  const studies = await Study.find(filter).sort({ studyDate: 1 }).exec();
  return studies;
};

/* ============================================================
   UPDATE STUDY
   ============================================================ */

const ALLOWED_UPDATE_FIELDS = ["studyDate", "studyType", "notes"];

export const updateStudy = async (params) => {
  const { studyId, actor, context, updates } = params;

  if (!updates || typeof updates !== "object") {
    throw new ValidationError("updates object is required");
  }

  const study = await Study.findOneActive({ _id: studyId });
  if (!study) {
    throw new NotFoundError("Study", studyId);
  }

  assertStudyAccess(study, actor);
  assertStudyEditable(study);

  const appliedFields = [];
  for (const field of ALLOWED_UPDATE_FIELDS) {
    if (updates[field] !== undefined) {
      study[field] = updates[field];
      appliedFields.push(field);
    }
  }

  if (appliedFields.length === 0) {
    throw new ValidationError("No valid fields to update", {
      allowedFields: ALLOWED_UPDATE_FIELDS,
    });
  }

  study.updatedBy = actor.userId;
  await study.save();

  await auditService.recordAction({
    actor,
    context,
    action: "study.update",
    resourceType: "Study",
    resourceId: study._id,
    caseId: study.caseId,
    metadata: { changedFields: appliedFields },
  });

  return study;
};

/* ============================================================
   COMPLETE STUDY
   ============================================================
   Финализация — после неё study нельзя редактировать.
   Используется когда врач закончил работу с фотосессией. */

export const completeStudy = async (params) => {
  const { studyId, actor, context } = params;

  const study = await Study.findOneActive({ _id: studyId });
  if (!study) {
    throw new NotFoundError("Study", studyId);
  }

  assertStudyAccess(study, actor);

  if (study.status === "completed") {
    throw new ConflictError("Study already completed");
  }
  if (!study.calibration?.isCalibrated) {
    throw new ConflictError("Cannot complete uncalibrated study", {
      requirement: "calibration",
    });
  }

  study.status = "completed";
  study.updatedBy = actor.userId;
  await study.save();

  await auditService.recordAction({
    actor,
    context,
    action: "study.update",
    resourceType: "Study",
    resourceId: study._id,
    caseId: study.caseId,
    metadata: { changedFields: ["status"], newStatus: "completed" },
  });

  return study;
};

/* ============================================================
   SOFT DELETE STUDY (TRANSACTIONAL)
   ============================================================
   Атомарно помечает Study + все её Photo + все Annotation
   как удалённые. Если любой шаг падает — всё откатывается.

   Если передан session — переиспользует его (вложенный вызов
   из cascadeDeleteStudiesByCase). Иначе создаёт свою транзакцию.
   ============================================================ */

export const softDeleteStudy = async (params) => {
  const { studyId, actor, context, reason, session: outerSession } = params;

  // Если нас вызвали внутри существующей транзакции — используем её.
  // Иначе создаём свою через withTransaction.
  if (outerSession) {
    return _softDeleteStudyInternal({
      studyId,
      actor,
      context,
      reason,
      session: outerSession,
    });
  }

  return withTransaction(async (session) => {
    return _softDeleteStudyInternal({
      studyId,
      actor,
      context,
      reason,
      session,
    });
  });
};

/**
 * Внутренняя имплементация — всегда работает в session.
 * Не экспортируется наружу.
 */
const _softDeleteStudyInternal = async ({
  studyId,
  actor,
  context,
  reason,
  session,
}) => {
  const study = await Study.findOneActive({ _id: studyId }).session(session);
  if (!study) {
    throw new NotFoundError("Study", studyId);
  }

  assertStudyAccess(study, actor);

  if (study.isDeleted) {
    throw new ConflictError("Study already deleted");
  }

  // Каскад на Photo и Annotation В ТРАНЗАКЦИИ
  const photoResult = await photoService.cascadeDeleteByStudy({
    studyId: study._id,
    actor,
    context,
    session,
  });

  // Помечаем сам study ПОСЛЕ каскада
  study.isDeleted = true;
  study.deletedAt = new Date();
  study.deletedBy = actor.userId;
  study.deleteReason = reason;
  await study.save({ session });

  // Audit log
  await auditService.recordAction({
    actor,
    context,
    action: "study.delete",
    resourceType: "Study",
    resourceId: study._id,
    caseId: study.caseId,
    metadata: {
      reason,
      cascadePhotosCount: photoResult.count,
    },
    session,
  });

  return {
    study,
    storageKeysToCleanup: photoResult.storageKeysToCleanup,
  };
};

/* ============================================================
   CASCADE DELETE BY CASE
   ============================================================
   Вызывается из case.service.softDeleteCase.
   Помечает все studies указанного case как удалённые,
   плюс каскадирует дальше на photo/annotation.

   Принимает обязательный session — вызывается только из
   родительской транзакции case.service. */

export const cascadeDeleteStudiesByCase = async ({
  caseId,
  actor,
  context,
  session,
}) => {
  if (!session) {
    throw new Error(
      "cascadeDeleteStudiesByCase requires a session — must be called from a transaction",
    );
  }

  // Найти все активные studies этого case
  const studies = await Study.find({ caseId, isDeleted: false }).session(
    session,
  );

  // Помечаем каждую через _softDeleteStudyInternal,
  // чтобы каскад продолжился вглубь (на photo, annotation).
  for (const study of studies) {
    await _softDeleteStudyInternal({
      studyId: study._id,
      actor,
      context,
      reason: "cascade from case deletion",
      session,
    });
  }

  return studies.length;
};

/* ============================================================
   DEFAULT EXPORT
   ============================================================ */

export default {
  createStudy,
  getStudy,
  listStudiesByCase,
  updateStudy,
  completeStudy,
  softDeleteStudy,
  cascadeDeleteStudiesByCase,
};
