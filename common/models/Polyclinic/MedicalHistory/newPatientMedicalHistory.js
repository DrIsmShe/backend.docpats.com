import mongoose from "mongoose";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  newPatientMedicalHistory — основная схема ENCOUNTER (визит / приём)
 *  Sprint 2 Phase 1 (UMR) — итерация v2
 *
 *  UMR-поля:
 *   - createdByEmployee, createdByClinicId — мульти-tenancy
 *   - status (draft/preliminary/signed/amended) — машина состояний
 *   - signedByUserId / signedByEmployeeId / signedAt — подпись
 *   - sharedWith — клиники, которым пациент дал доступ к этой записи
 *
 *  ⚠️ LEGACY MIRROR ПОЛЕ:
 *   - diagnosis (String) — зеркало mainDiagnosis.text для compat с фронтом.
 *     Pre-save hook автоматически синхронизирует diagnosis ← mainDiagnosis.text
 *     при каждом save. Контроллеры НЕ заполняют его вручную.
 *
 *     План на Phase 2: переучить фронт на mainDiagnosis.text, удалить mirror.
 *
 *  УДАЛЕНО:
 *   - isConsentGiven (Boolean) → заменено моделью PatientConsent (Day 3)
 *
 *  Валидация:
 *   - Ровно один создатель: createdBy (User) ИЛИ createdByEmployee
 *   - Employee-автор обязан иметь createdByClinicId
 *   - mainDiagnosis обязателен только для status ∈ {signed, amended}
 *   - signedAt + signedBy* обязательны для status ∈ {signed, amended}
 * ─────────────────────────────────────────────────────────────────────────────
 */

const newPatientMedicalHistorySchema = new mongoose.Schema(
  {
    // ── АВТОРСТВО (UMR) ───────────────────────────────────────────
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    createdByEmployee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClinicEmployee",
      default: null,
    },
    createdByClinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      default: null,
      index: true,
    },

    // ── STATUS MACHINE (UMR) ──────────────────────────────────────
    status: {
      type: String,
      enum: ["draft", "preliminary", "signed", "amended"],
      default: "draft",
      index: true,
    },
    signedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    signedByEmployeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClinicEmployee",
      default: null,
    },
    signedAt: { type: Date, default: null },

    // ── CONSENT (UMR) ─────────────────────────────────────────────
    sharedWith: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Clinic" }],
      default: [],
    },

    // ── СОДЕРЖИМОЕ ────────────────────────────────────────────────
    metaDescription: { type: [String], default: [] },
    metaKeywords: { type: [String], default: [] },
    isPublished: { type: Boolean, default: false },

    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    doctorProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DoctorProfile",
    },

    views: { type: Number, default: 0 },
    readTime: { type: Number, default: 0 },

    complaints: { type: String, trim: true },
    anamnesisMorbi: { type: String, trim: true },
    anamnesisVitae: { type: String, trim: true },
    statusPreasens: { type: String, trim: true },
    statusLocalis: { type: String, trim: true },
    recommendations: { type: String, trim: true },
    ctScanResults: { type: String, trim: true },
    mriResults: { type: String, trim: true },
    ultrasoundResults: { type: String, trim: true },
    laboratoryTestResults: { type: String, trim: true },

    // Структурный диагноз (новый, основной)
    mainDiagnosis: {
      code: { type: String, trim: true, default: "" },
      codeTitle: { type: String, trim: true, default: "" },
      text: { type: String, trim: true, default: "" },
    },

    // ⚠️ LEGACY MIRROR — синхронизируется автоматически из mainDiagnosis.text
    // через pre-save hook. НЕ заполнять вручную!
    diagnosis: { type: String, trim: true, default: "" },

    additionalDiagnosis: { type: String, trim: true },

    files: [{ type: mongoose.Schema.Types.ObjectId, ref: "File", default: [] }],

    history: [
      {
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        updatedAt: { type: Date, default: Date.now },
        changes: {
          field: String,
          oldValue: mongoose.Schema.Types.Mixed,
          newValue: mongoose.Schema.Types.Mixed,
        },
      },
    ],

    documents: [
      {
        name: { type: String, trim: true },
        url: { type: String, trim: true },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],

    allergies: [
      { type: mongoose.Schema.Types.ObjectId, ref: "allergiesPatient" },
    ],
    familyHistoryOfDisease: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "familyHistoryOfDiseasePatient",
      },
    ],
    operations: [
      { type: mongoose.Schema.Types.ObjectId, ref: "operationsPatient" },
    ],
    chronicDiseases: [
      { type: mongoose.Schema.Types.ObjectId, ref: "chronicDiseasesPatient" },
    ],
    immunization: [
      { type: mongoose.Schema.Types.ObjectId, ref: "immunizationPatient" },
    ],

    patientType: {
      type: String,
      enum: ["registered", "private"],
      required: true,
      index: true,
    },
    patientRef: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "patientTypeModel",
    },
    patientTypeModel: {
      type: String,
      required: true,
      enum: ["DoctorPrivatePatient", "NewPatientPolyclinic", "ClinicPatient"],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// ── ИНДЕКСЫ ──────────────────────────────────────────────────────
newPatientMedicalHistorySchema.index({ patientType: 1, patientRef: 1 });
newPatientMedicalHistorySchema.index({ "mainDiagnosis.code": 1 });
newPatientMedicalHistorySchema.index({ createdByClinicId: 1, createdAt: -1 });
newPatientMedicalHistorySchema.index({ sharedWith: 1 });

// ── ВАЛИДАЦИЯ ────────────────────────────────────────────────────
newPatientMedicalHistorySchema.pre("validate", function (next) {
  const hasUser = !!this.createdBy;
  const hasEmployee = !!this.createdByEmployee;

  if (!hasUser && !hasEmployee) {
    return next(
      new Error(
        "Author is required: either createdBy (User) or createdByEmployee (ClinicEmployee) must be set.",
      ),
    );
  }
  if (hasUser && hasEmployee) {
    return next(
      new Error(
        "Only one author allowed: createdBy and createdByEmployee are mutually exclusive.",
      ),
    );
  }
  if (hasEmployee && !this.createdByClinicId) {
    return next(
      new Error(
        "createdByClinicId is required when record is created by ClinicEmployee.",
      ),
    );
  }

  if (this.isNew && (this.status === "signed" || this.status === "amended")) {
    const md = this.mainDiagnosis;
    if (!md?.code?.trim() || !md?.text?.trim()) {
      return next(
        new Error(
          "Signed/amended records require ICD-10 code and diagnosis text in mainDiagnosis.",
        ),
      );
    }
    if (!this.signedAt) {
      return next(
        new Error("signedAt is required for signed/amended records."),
      );
    }
    if (!this.signedByUserId && !this.signedByEmployeeId) {
      return next(
        new Error(
          "signedByUserId or signedByEmployeeId is required for signed/amended records.",
        ),
      );
    }
  }

  next();
});

// ── AUTO-MIRROR: diagnosis ← mainDiagnosis.text ──────────────────
// Срабатывает на каждом save (create + update через .save()).
// Контроллеры пишут только в mainDiagnosis, mirror обновляется сам.
newPatientMedicalHistorySchema.pre("save", function (next) {
  if (this.mainDiagnosis?.text) {
    this.diagnosis = this.mainDiagnosis.text;
  }
  next();
});

const newPatientMedicalHistoryModel = mongoose.model(
  "newPatientMedicalHistory",
  newPatientMedicalHistorySchema,
);

export default newPatientMedicalHistoryModel;
