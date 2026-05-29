import mongoose from "mongoose";

/**
 * 🧬 familyHistoryOfDiseasePatient — наследственные заболевания
 *  Sprint 2 Phase 1 (UMR) — patient-attribute шаблон
 *
 *  UMR-поля: createdByEmployee, createdByClinicId, sharedWith
 *
 *  Валидация:
 *   - Ровно один создатель: doctorId (User) ИЛИ createdByEmployee
 *   - Если createdByEmployee — обязателен createdByClinicId
 */

const familyHistoryOfDiseasePatientSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NewPatientPolyclinic",
      required: true,
    },

    // ── АВТОРСТВО (UMR) ──────────────────────────────────────────
    doctorId: {
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

    // ── CONSENT (UMR) ────────────────────────────────────────────
    sharedWith: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Clinic" }],
      default: [],
    },

    // ── СОДЕРЖИМОЕ ───────────────────────────────────────────────
    relative: {
      type: String,
      trim: true,
      required: true,
    },
    diseaseName: {
      type: String,
      trim: true,
      required: true,
    },
    content: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
  },
);

familyHistoryOfDiseasePatientSchema.index({
  patientId: 1,
  doctorId: 1,
  relative: 1,
});
familyHistoryOfDiseasePatientSchema.index({
  createdByClinicId: 1,
  createdAt: -1,
});
familyHistoryOfDiseasePatientSchema.index({ sharedWith: 1 });

familyHistoryOfDiseasePatientSchema.pre("validate", function (next) {
  const hasUser = !!this.doctorId;
  const hasEmployee = !!this.createdByEmployee;

  if (!hasUser && !hasEmployee) {
    return next(
      new Error(
        "Author is required: either doctorId (User) or createdByEmployee (ClinicEmployee) must be set.",
      ),
    );
  }
  if (hasUser && hasEmployee) {
    return next(
      new Error(
        "Only one author allowed: doctorId and createdByEmployee are mutually exclusive.",
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

const familyHistoryOfDiseasePatient =
  mongoose.models.familyHistoryOfDiseasePatient ||
  mongoose.model(
    "familyHistoryOfDiseasePatient",
    familyHistoryOfDiseasePatientSchema,
  );

export default familyHistoryOfDiseasePatient;
