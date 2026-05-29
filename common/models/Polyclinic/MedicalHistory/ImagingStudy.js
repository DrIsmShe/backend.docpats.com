import mongoose from "mongoose";
import File from "../../file.js";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  ImagingStudy — медицинское исследование пациента (КТ/МРТ/УЗИ/...)
 *  Sprint 2 Phase 1 (UMR) + Phase 2C.2 (clinic-medical support)
 *
 *  Это PATIENT ATTRIBUTE — самостоятельная запись, не привязана к encounter.
 *
 *  ДВА FLOW:
 *   - myClinic (фрилансер): patient (NewPatientPolyclinic) + studyReference
 *     + studyTypeReference (ссылка на конкретный scan-документ CTScan/MRIScan)
 *   - clinic-medical (clinic-employee): patientId (ClinicPatient) + studyType
 *     + images[] (простая загрузка снимков, без scan-референса)
 *
 *  Phase 2C.2 изменения:
 *   - patient: required снято (clinic-medical использует patientId)
 *   - patientId: NEW — ссылка на ClinicPatient (для clinic-medical flow)
 *   - studyReference / studyTypeReference: required снято (clinic-medical
 *     не создаёт scan-документы, грузит снимки напрямую)
 *   - валидатор: хотя бы одно из patient / patientId должно быть задано
 *
 *  Авторство (Phase 1 UMR):
 *   - createdBy           — автор-User (фрилансер)
 *   - createdByEmployee   — автор-сотрудник клиники
 *   - createdByClinicId   — клиника-автор. null = фрилансер.
 *   - sharedWith          — клиники с доступом
 *
 *  ⚠️ status/signedBy НЕ добавляются — у ImagingStudy свой workflow через
 *     validatedByDoctor + doctorNotes.
 *
 *  Валидация:
 *   - Хотя бы один пациент: patient (NewPatientPolyclinic) ИЛИ patientId (ClinicPatient)
 *   - Ровно один создатель: createdBy (User) ИЛИ createdByEmployee
 *   - Если createdByEmployee — обязателен createdByClinicId
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fileSchema = File.schema;

const imagingStudySchema = new mongoose.Schema(
  {
    // ──────────────────────────────────────────────────────────────
    //  ПАЦИЕНТ — два варианта в зависимости от flow
    // ──────────────────────────────────────────────────────────────

    // myClinic flow — registered polyclinic patient
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NewPatientPolyclinic",
      default: null,
    },

    // clinic-medical flow — clinic patient (Phase 2C.2 NEW)
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClinicPatient",
      default: null,
      index: true,
    },

    // ──────────────────────────────────────────────────────────────
    //  АВТОРСТВО (UMR)
    // ──────────────────────────────────────────────────────────────

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

    // ──────────────────────────────────────────────────────────────
    //  CONSENT (UMR)
    // ──────────────────────────────────────────────────────────────

    sharedWith: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Clinic" }],
      default: [],
    },

    // ──────────────────────────────────────────────────────────────
    //  СОДЕРЖИМОЕ
    // ──────────────────────────────────────────────────────────────

    studyType: {
      type: String,
      enum: [
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
      ],
      required: true,
    },

    // Phase 2C.2: required снято — clinic-medical не создаёт scan-документы
    studyReference: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "studyTypeReference",
      default: null,
    },

    studyTypeReference: {
      type: String,
      default: null,
      enum: [
        "CTScan",
        "MRIScan",
        "Ultrasound",
        "XRay",
        "PETScan",
        "SPECTScan",
        "EEG",
        "ECG",
        "HolterMonitor",
        "Spirometry",
        "DopplerScan",
        "Gastroscopy",
        "Colonoscopy",
        "CapsuleEndoscopy",
        null,
      ],
    },

    date: { type: Date, default: Date.now },

    images: [{ type: String }],
    rawData: { type: String },
    pacsLink: { type: String },

    report: { type: String },
    diagnosis: { type: String },
    contrastUsed: { type: Boolean, default: false },

    previousStudy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ImagingStudy",
    },
    relatedStudies: [
      { type: mongoose.Schema.Types.ObjectId, ref: "ImagingStudy" },
    ],

    // 🧠 ИИ
    aiFindings: { type: mongoose.Schema.Types.Mixed },
    aiConfidence: { type: Number, min: 0, max: 1 },
    aiVersion: { type: String },
    aiPrediction: { type: String },
    predictionConfidence: { type: Number, min: 0, max: 1 },
    aiProcessingTime: { type: Number },
    aiProcessedAt: { type: Date },

    // 👨‍⚕️ Workflow подтверждения (ImagingStudy-специфичная замена status)
    validatedByDoctor: { type: Boolean, default: false },
    doctorNotes: { type: String },

    // 📎 Файлы
    files: [fileSchema],

    // 🔧 Дополнительные
    threeDModel: { type: String },
    imageQuality: { type: Number, min: 0, max: 100 },
    needsRetake: { type: Boolean, default: false },
    riskLevel: { type: String, enum: ["low", "medium", "high"] },
    riskFactors: [{ type: String }],

    // 💬 Комментарии врачей
    doctorComments: [
      {
        doctor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        text: { type: String },
        date: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  },
);

// ─────────────────────────────────────────────────────────────────────────────
//  ИНДЕКСЫ
// ─────────────────────────────────────────────────────────────────────────────

imagingStudySchema.index({ patient: 1, studyType: 1, date: -1 });
imagingStudySchema.index({ patientId: 1, studyType: 1, date: -1 });
imagingStudySchema.index({ aiPrediction: "text", diagnosis: "text" });
imagingStudySchema.index({ createdByClinicId: 1, createdAt: -1 });
imagingStudySchema.index({ sharedWith: 1 });

// ─────────────────────────────────────────────────────────────────────────────
//  ВАЛИДАЦИЯ
// ─────────────────────────────────────────────────────────────────────────────

imagingStudySchema.pre("validate", function (next) {
  // At least one patient reference (myClinic uses `patient`, clinic-medical
  // uses `patientId`).
  if (!this.patient && !this.patientId) {
    return next(
      new Error(
        "Patient is required: either patient (NewPatientPolyclinic) or patientId (ClinicPatient) must be set.",
      ),
    );
  }

  // Exactly one author.
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
  next();
});

const ImagingStudy =
  mongoose.models.ImagingStudy ||
  mongoose.model("ImagingStudy", imagingStudySchema);

export default ImagingStudy;
