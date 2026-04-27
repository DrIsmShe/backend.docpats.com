// server/modules/anthropometry/services/case.service.js
import studyService from "./study.service.js";
import { withTransaction } from "../../../common/utils/db.js";
import mongoose from "mongoose";
import PatientCase from "../models/PatientCase.model.js";
import auditService from "./audit.service.js";
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
  ConflictError,
} from "../utils/errors.js";

/* ============================================================
   PRIVATE HELPERS
   ============================================================ */

/**
 * Резолв doctorProfileId для текущего актора.
 */
const resolveDoctorProfileId = async (actor) => {
  const DoctorProfile = mongoose.model("DoctorProfile");
  const profile = await DoctorProfile.findOne({ userId: actor.userId });
  if (!profile) {
    throw new NotFoundError("DoctorProfile", `for user ${actor.userId}`);
  }
  return profile._id;
};

/**
 * Проверка существования пациента.
 */
const assertPatientExists = async (patientType, patientId, session) => {
  const modelName =
    patientType === "registered"
      ? "NewPatientPolyclinic"
      : "DoctorPrivatePatient";

  const PatientModel = mongoose.model(modelName);
  const query = PatientModel.exists({ _id: patientId });
  if (session) query.session(session);
  const exists = await query;

  if (!exists) {
    throw new NotFoundError(modelName, patientId);
  }
};

/**
 * Создание DoctorPrivatePatient в транзакции.
 *
 * ВАЖНО: модель DoctorPrivatePatient использует virtual setters
 * для firstName/lastName/email/phoneNumber — они автоматически
 * шифруют значения в *Encrypted поля и считают *Hash.
 *
 * Model.create(plainObject) НЕ вызывает virtual setters — plain
 * properties просто теряются. Поэтому используем:
 *   new Model() + присваивание через dot-notation + .save()
 *
 * Обязательные поля модели (требуют шифрованных версий):
 *   - firstNameEncrypted (required)
 *   - lastNameEncrypted  (required)
 *   - doctorProfileId    (required)
 */
const createInlinePrivatePatient = async ({
  actor,
  doctorProfileId,
  privatePatient,
  session,
}) => {
  const PrivatePatientModel = mongoose.model("DoctorPrivatePatient");

  // Создаём через new — так работают virtual setters
  const doc = new PrivatePatientModel({
    doctorProfileId, // required на уровне модели
    doctorUserId: actor.userId,
    createdBy: actor.userId,
  });

  // Виртуалы-сеттеры шифруют значения в firstNameEncrypted + hash
  doc.firstName = privatePatient.firstName;
  doc.lastName = privatePatient.lastName;

  // Опциональные поля
  if (privatePatient.gender) doc.gender = privatePatient.gender;
  if (privatePatient.dateOfBirth) doc.dateOfBirth = privatePatient.dateOfBirth;
  if (privatePatient.notes) doc.notes = privatePatient.notes;
  if (privatePatient.email) doc.email = privatePatient.email;

  await doc.save({ session });

  return doc._id;
};

/**
 * Проверка что актор имеет доступ к случаю.
 */
const assertCaseAccess = (caseDoc, actor) => {
  if (String(caseDoc.doctorUserId) !== String(actor.userId)) {
    throw new ForbiddenError("case access", "case belongs to another doctor");
  }
};

/**
 * Проверка что случай в редактируемом состоянии.
 */
const assertCaseEditable = (caseDoc) => {
  if (caseDoc.isDeleted) {
    throw new ConflictError("Cannot modify deleted case", { isDeleted: true });
  }
  if (caseDoc.isArchived) {
    throw new ConflictError("Cannot modify archived case", {
      isArchived: true,
    });
  }
};

/* ============================================================
   CREATE CASE
   ============================================================ */

export const createCase = async (params) => {
  const { actor, context, data } = params;

  if (
    !data?.patientType ||
    !["registered", "private"].includes(data.patientType)
  ) {
    throw new ValidationError("patientType must be 'registered' or 'private'");
  }
  if (!data.procedureType) {
    throw new ValidationError("procedureType is required");
  }

  const hasPatientId = !!data.patientId;
  const hasInlinePrivate = !!data.privatePatient;

  if (!hasPatientId && !hasInlinePrivate) {
    throw new ValidationError(
      "Either patientId or privatePatient inline object is required",
    );
  }

  if (hasInlinePrivate && data.patientType !== "private") {
    throw new ValidationError(
      "Inline privatePatient is only allowed when patientType is 'private'",
    );
  }

  // Inline-вариант: firstName + lastName обязательны (модель требует
  // firstNameEncrypted и lastNameEncrypted как required). encrypt("")
  // возвращает undefined, что не проходит валидацию.
  if (hasInlinePrivate) {
    if (!data.privatePatient.firstName?.trim()) {
      throw new ValidationError("privatePatient.firstName is required");
    }
    if (!data.privatePatient.lastName?.trim()) {
      throw new ValidationError("privatePatient.lastName is required");
    }
  }

  return withTransaction(async (session) => {
    let doctorProfileId = data.doctorProfileId;
    if (!doctorProfileId) {
      doctorProfileId = await resolveDoctorProfileId(actor);
    }

    let patientId;

    if (hasInlinePrivate) {
      patientId = await createInlinePrivatePatient({
        actor,
        doctorProfileId,
        privatePatient: data.privatePatient,
        session,
      });
    } else {
      patientId = data.patientId;
      await assertPatientExists(data.patientType, patientId, session);
    }

    const caseData = {
      patientType: data.patientType,
      [data.patientType === "registered"
        ? "registeredPatientId"
        : "privatePatientId"]: patientId,

      doctorUserId: actor.userId,
      doctorProfileId,

      procedureType: data.procedureType,
      status: "consultation",

      createdBy: actor.userId,
    };

    const newCase = new PatientCase(caseData);
    // chiefComplaint/medicalNotes — виртуалы, шифруются через setter
    if (data.chiefComplaint) newCase.chiefComplaint = data.chiefComplaint;
    if (data.medicalNotes) newCase.medicalNotes = data.medicalNotes;

    await newCase.save({ session });

    auditService.recordActionAsync({
      actor,
      context,
      action: "case.create",
      resourceType: "PatientCase",
      resourceId: newCase._id,
      caseId: newCase._id,
      metadata: {
        procedureType: newCase.procedureType,
        patientType: newCase.patientType,
        inlinePrivatePatient: hasInlinePrivate,
      },
    });

    return newCase;
  });
};

/* ============================================================
   GET CASE
   ============================================================ */

export const getCase = async (params) => {
  const { caseId, actor, context, populate = false } = params;

  let query = PatientCase.findOneActive({ _id: caseId });

  /* Populate: выбираем ENCRYPTED поля (реальные в БД). Виртуалы
     firstName/lastName/email/phoneNumber/fullName вычисляются автоматически
     через getter и попадают в JSON response благодаря toJSON:{virtuals:true}.
     Сами encrypted поля удаляются из ответа через toJSON.transform. */
  if (populate) {
    query = query
      .populate(
        "registeredPatientId",
        "firstNameEncrypted lastNameEncrypted emailEncrypted phoneEncrypted gender dateOfBirth avatar",
      )
      .populate(
        "privatePatientId",
        "firstNameEncrypted lastNameEncrypted emailEncrypted phoneEncrypted gender dateOfBirth image",
      );
  }

  const caseDoc = await query.exec();

  if (!caseDoc) {
    throw new NotFoundError("PatientCase", caseId);
  }

  try {
    assertCaseAccess(caseDoc, actor);
  } catch (err) {
    auditService.recordActionAsync({
      actor,
      context,
      action: "case.view",
      resourceType: "PatientCase",
      resourceId: caseId,
      outcome: "denied",
      failureReason: err.message,
    });
    throw err;
  }

  auditService.recordActionAsync({
    actor,
    context,
    action: "case.view",
    resourceType: "PatientCase",
    resourceId: caseDoc._id,
    caseId: caseDoc._id,
  });

  return caseDoc;
};

/* ============================================================
   LIST CASES
   ============================================================ */

export const listCasesByDoctor = async (params) => {
  const { actor, filter = {}, options = {} } = params;

  const { status, procedureType, isArchived = false } = filter;

  const {
    limit = 20,
    skip = 0,
    sortBy = "createdAt",
    sortOrder = -1,
  } = options;

  const safeLimit = Math.min(Math.max(1, limit), 100);

  const mongoFilter = {
    doctorUserId: actor.userId,
    isDeleted: false,
    isArchived,
  };
  if (status) mongoFilter.status = status;
  if (procedureType) mongoFilter.procedureType = procedureType;

  const [items, total] = await Promise.all([
    PatientCase.find(mongoFilter)
      .sort({ [sortBy]: sortOrder })
      .skip(skip)
      .limit(safeLimit)
      /* Populate и в списке — чтобы в CaseCard показывать имя пациента
         без отдельного запроса. Тот же projection что и в getCase. */
      .populate(
        "privatePatientId",
        "firstNameEncrypted lastNameEncrypted gender",
      )
      .populate(
        "registeredPatientId",
        "firstNameEncrypted lastNameEncrypted gender avatar",
      )
      .exec(),
    PatientCase.countDocuments(mongoFilter),
  ]);

  return {
    items,
    total,
    hasMore: skip + items.length < total,
    pagination: { limit: safeLimit, skip },
  };
};

/* ============================================================
   UPDATE CASE
   ============================================================ */

const ALLOWED_UPDATE_FIELDS = [
  "status",
  "chiefComplaint",
  "medicalNotes",
  "plannedOperationDate",
  "actualOperationDate",
];

export const updateCase = async (params) => {
  const { caseId, actor, context, updates } = params;

  if (!updates || typeof updates !== "object") {
    throw new ValidationError("updates object is required");
  }

  const caseDoc = await PatientCase.findOneActive({ _id: caseId });
  if (!caseDoc) {
    throw new NotFoundError("PatientCase", caseId);
  }

  assertCaseAccess(caseDoc, actor);
  assertCaseEditable(caseDoc);

  const appliedFields = [];
  for (const field of ALLOWED_UPDATE_FIELDS) {
    if (updates[field] !== undefined) {
      caseDoc[field] = updates[field];
      appliedFields.push(field);
    }
  }

  if (appliedFields.length === 0) {
    throw new ValidationError("No valid fields to update", {
      allowedFields: ALLOWED_UPDATE_FIELDS,
    });
  }

  caseDoc.updatedBy = actor.userId;
  await caseDoc.save();

  await auditService.recordAction({
    actor,
    context,
    action: "case.update",
    resourceType: "PatientCase",
    resourceId: caseDoc._id,
    caseId: caseDoc._id,
    metadata: { changedFields: appliedFields },
  });

  return caseDoc;
};

/* ============================================================
   GIVE CONSENT
   ============================================================ */

export const giveConsent = async (params) => {
  const { caseId, actor, context, consentDocumentUrl } = params;

  const caseDoc = await PatientCase.findOneActive({ _id: caseId });
  if (!caseDoc) {
    throw new NotFoundError("PatientCase", caseId);
  }

  assertCaseAccess(caseDoc, actor);
  assertCaseEditable(caseDoc);

  if (caseDoc.consentGiven) {
    throw new ConflictError("Consent already given for this case", {
      consentGivenAt: caseDoc.consentGivenAt,
    });
  }

  caseDoc.consentGiven = true;
  if (consentDocumentUrl) {
    caseDoc.consentDocumentUrl = consentDocumentUrl;
  }
  caseDoc.updatedBy = actor.userId;

  await caseDoc.save();

  await auditService.recordAction({
    actor,
    context,
    action: "case.consent_given",
    resourceType: "PatientCase",
    resourceId: caseDoc._id,
    caseId: caseDoc._id,
    metadata: {
      consentDocumentUrl: consentDocumentUrl || null,
      consentGivenAt: caseDoc.consentGivenAt,
    },
  });

  return caseDoc;
};

/* ============================================================
   ARCHIVE / UNARCHIVE
   ============================================================ */

export const archiveCase = async (params) => {
  const { caseId, actor, context, reason } = params;

  const caseDoc = await PatientCase.findOneActive({ _id: caseId });
  if (!caseDoc) {
    throw new NotFoundError("PatientCase", caseId);
  }

  assertCaseAccess(caseDoc, actor);

  if (caseDoc.isArchived) {
    throw new ConflictError("Case already archived", { isArchived: true });
  }

  caseDoc.isArchived = true;
  caseDoc.archivedAt = new Date();
  caseDoc.archiveReason = reason;
  caseDoc.updatedBy = actor.userId;

  await caseDoc.save();

  await auditService.recordAction({
    actor,
    context,
    action: "case.archive",
    resourceType: "PatientCase",
    resourceId: caseDoc._id,
    caseId: caseDoc._id,
    metadata: { reason },
  });

  return caseDoc;
};

export const unarchiveCase = async (params) => {
  const { caseId, actor, context } = params;

  const caseDoc = await PatientCase.findOneActive({ _id: caseId });
  if (!caseDoc) {
    throw new NotFoundError("PatientCase", caseId);
  }

  assertCaseAccess(caseDoc, actor);

  if (!caseDoc.isArchived) {
    throw new ConflictError("Case is not archived", { isArchived: false });
  }

  caseDoc.isArchived = false;
  caseDoc.archivedAt = undefined;
  caseDoc.archiveReason = undefined;
  caseDoc.updatedBy = actor.userId;

  await caseDoc.save();

  await auditService.recordAction({
    actor,
    context,
    action: "case.unarchive",
    resourceType: "PatientCase",
    resourceId: caseDoc._id,
    caseId: caseDoc._id,
  });

  return caseDoc;
};

/* ============================================================
   SOFT DELETE
   ============================================================ */

export const softDeleteCase = async (params) => {
  const { caseId, actor, context, reason } = params;

  return withTransaction(async (session) => {
    const caseDoc = await PatientCase.findOneActive({ _id: caseId }).session(
      session,
    );
    if (!caseDoc) {
      throw new NotFoundError("PatientCase", caseId);
    }

    assertCaseAccess(caseDoc, actor);

    if (caseDoc.isDeleted) {
      throw new ConflictError("Case already deleted", { isDeleted: true });
    }

    caseDoc.isDeleted = true;
    caseDoc.deletedAt = new Date();
    caseDoc.deletedBy = actor.userId;
    caseDoc.deleteReason = reason;
    await caseDoc.save({ session });

    const deletedStudiesCount = await studyService.cascadeDeleteStudiesByCase({
      caseId: caseDoc._id,
      actor,
      context,
      session,
    });

    await auditService.recordAction({
      actor,
      context,
      action: "case.delete",
      resourceType: "PatientCase",
      resourceId: caseDoc._id,
      caseId: caseDoc._id,
      metadata: { reason, cascadeStudiesCount: deletedStudiesCount },
      session,
    });

    return caseDoc;
  });
};

/* ============================================================
   DEFAULT EXPORT
   ============================================================ */

export default {
  createCase,
  getCase,
  listCasesByDoctor,
  updateCase,
  giveConsent,
  archiveCase,
  unarchiveCase,
  softDeleteCase,
};
