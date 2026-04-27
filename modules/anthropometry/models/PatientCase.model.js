// server/modules/anthropometry/models/PatientCase.model.js

import mongoose from "mongoose";
import { encrypt, decrypt } from "../../../common/utils/crypto.js";

const { Schema } = mongoose;

/* ============================================================
   ENUMS
   ============================================================ */
const PROCEDURE_TYPE_ENUM = [
  "rhinoplasty", // ринопластика — текущая фаза разработки
  "mammoplasty", // маммопластика
  "facelift", // фейслифтинг
  "blepharoplasty", // блефаропластика
  "liposuction", // липосакция
  "otoplasty", // отопластика
  "other", // прочее
];

const CASE_STATUS_ENUM = [
  "consultation", // первичная консультация
  "planned", // операция запланирована
  "operated", // операция проведена
  "follow_up", // послеоперационное наблюдение
  "closed", // случай закрыт
  "cancelled", // пациент отказался
];

const PATIENT_TYPE_ENUM = ["registered", "private"];

/* ============================================================
   SCHEMA
   ============================================================ */
const PatientCaseSchema = new Schema(
  {
    /* ---------------------------------
       PATIENT REFERENCE (discriminator)
       ---------------------------------
       Заполняется ОДНО из двух полей в зависимости
       от patientType. Валидация в pre('validate'). */
    patientType: {
      type: String,
      enum: PATIENT_TYPE_ENUM,
      required: true,
      index: true,
    },

    registeredPatientId: {
      type: Schema.Types.ObjectId,
      ref: "NewPatientPolyclinic",
      default: null,
      index: true,
    },

    privatePatientId: {
      type: Schema.Types.ObjectId,
      ref: "DoctorPrivatePatient",
      default: null,
      index: true,
    },

    /* ---------------------------------
       OWNERSHIP
       --------------------------------- */
    doctorUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    doctorProfileId: {
      type: Schema.Types.ObjectId,
      ref: "DoctorProfile",
      index: true,
    },

    /* ---------------------------------
       CASE METADATA
       --------------------------------- */
    procedureType: {
      type: String,
      enum: PROCEDURE_TYPE_ENUM,
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: CASE_STATUS_ENUM,
      default: "consultation",
      index: true,
    },

    /* ---------------------------------
       CLINICAL DATA (encrypted)
       --------------------------------- */
    // Жалоба пациента ("горбинка", "широкий кончик")
    chiefComplaintEncrypted: { type: String },

    // Анамнез, противопоказания, аллергии — высокочувствительный PHI
    medicalNotesEncrypted: { type: String },

    /* ---------------------------------
       LEGAL / CONSENT
       ---------------------------------
       Минимальный набор для пластической хирургии.
       Полная модель ConsentRecord (с подписанным PDF,
       IP, версией формы) — отдельная задача. */
    consentGiven: { type: Boolean, default: false },
    consentGivenAt: { type: Date },
    consentDocumentUrl: { type: String },

    /* ---------------------------------
       OPERATIONAL DATES
       --------------------------------- */
    plannedOperationDate: { type: Date },
    actualOperationDate: { type: Date },

    /* ---------------------------------
       SOFT DELETE & ARCHIVE
       ---------------------------------
       isArchived — пользовательское действие,
                    случай скрыт из активного списка
       isDeleted  — административное удаление,
                    скрыто отовсюду, но физически осталось
                    (HIPAA / медицинское законодательство) */
    isArchived: { type: Boolean, default: false, index: true },
    archivedAt: { type: Date },
    archiveReason: { type: String },

    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" },
    deleteReason: { type: String },

    /* ---------------------------------
       AUDIT
       --------------------------------- */
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_, ret) => {
        // Не отдаём зашифрованные поля наружу
        delete ret.chiefComplaintEncrypted;
        delete ret.medicalNotesEncrypted;
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

/* ============================================================
   VIRTUALS — прозрачный доступ к шифрованным полям
   ============================================================
   Использование в сервисах:
     case.chiefComplaint = "горбинка";  // авто-шифруется
     console.log(case.chiefComplaint);  // авто-расшифровывается */

PatientCaseSchema.virtual("chiefComplaint")
  .get(function () {
    return decrypt(this.chiefComplaintEncrypted);
  })
  .set(function (val) {
    this.chiefComplaintEncrypted = encrypt(val);
  });

PatientCaseSchema.virtual("medicalNotes")
  .get(function () {
    return decrypt(this.medicalNotesEncrypted);
  })
  .set(function (val) {
    this.medicalNotesEncrypted = encrypt(val);
  });

/* ============================================================
   VALIDATION HOOKS
   ============================================================ */

// Гарантируем что patientType соответствует заполненной ссылке
PatientCaseSchema.pre("validate", function (next) {
  if (this.patientType === "registered") {
    if (!this.registeredPatientId) {
      return next(
        new Error(
          "registeredPatientId is required when patientType=registered",
        ),
      );
    }
    if (this.privatePatientId) {
      return next(
        new Error("privatePatientId must be null when patientType=registered"),
      );
    }
  } else if (this.patientType === "private") {
    if (!this.privatePatientId) {
      return next(
        new Error("privatePatientId is required when patientType=private"),
      );
    }
    if (this.registeredPatientId) {
      return next(
        new Error("registeredPatientId must be null when patientType=private"),
      );
    }
  }
  next();
});

// Авто-проставление consentGivenAt при включении флага
PatientCaseSchema.pre("save", function (next) {
  if (
    this.isModified("consentGiven") &&
    this.consentGiven &&
    !this.consentGivenAt
  ) {
    this.consentGivenAt = new Date();
  }
  next();
});

/* ============================================================
   INSTANCE METHODS
   ============================================================ */

// Возвращает правильную ссылку на пациента в зависимости от типа.
// Используется в сервисах вместо ручного if/else.
PatientCaseSchema.methods.getPatientRef = function () {
  if (this.patientType === "registered") {
    return {
      type: "registered",
      id: this.registeredPatientId,
      modelName: "NewPatientPolyclinic",
    };
  }
  return {
    type: "private",
    id: this.privatePatientId,
    modelName: "DoctorPrivatePatient",
  };
};

// Проверка: можно ли создавать симуляцию для этого случая
PatientCaseSchema.methods.canCreateSimulation = function () {
  return (
    this.consentGiven === true &&
    this.isDeleted === false &&
    this.isArchived === false
  );
};

/* ============================================================
   STATIC METHODS
   ============================================================ */

// Базовый запрос "активные случаи" — фильтрует удалённые.
// Используем во всех сервисных запросах вместо ручного добавления
// { isDeleted: false } каждый раз.
PatientCaseSchema.statics.findActive = function (filter = {}) {
  return this.find({ ...filter, isDeleted: false });
};

PatientCaseSchema.statics.findOneActive = function (filter = {}) {
  return this.findOne({ ...filter, isDeleted: false });
};

/* ============================================================
   INDEXES
   ============================================================ */

// Главный экран врача: активные случаи, отсортированные
PatientCaseSchema.index({ doctorUserId: 1, status: 1, isDeleted: 1 });

// Хронологическая лента случаев врача
PatientCaseSchema.index({ doctorUserId: 1, createdAt: -1 });

// История случаев пациента (registered)
PatientCaseSchema.index({ registeredPatientId: 1, isDeleted: 1 });

// История случаев пациента (private)
PatientCaseSchema.index({ privatePatientId: 1, isDeleted: 1 });

// Фильтр по типу процедуры
PatientCaseSchema.index({ doctorUserId: 1, procedureType: 1, status: 1 });

/* ============================================================
   MODEL
   ============================================================ */
const PatientCase =
  mongoose.models.PatientCase ||
  mongoose.model("PatientCase", PatientCaseSchema, "patient_cases");

export default PatientCase;
