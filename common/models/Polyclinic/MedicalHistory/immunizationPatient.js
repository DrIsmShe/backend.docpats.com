import mongoose from "mongoose";

/**
 * 💉 immunizationPatient — иммунизация пациента
 *  Sprint 2 Phase 1 (UMR) — patient-attribute шаблон
 *
 *  UMR-поля: createdByEmployee, createdByClinicId, sharedWith
 *
 *  Валидация:
 *   - Ровно один создатель: doctorId (User) ИЛИ createdByEmployee
 *   - Если createdByEmployee — обязателен createdByClinicId
 */

const immunizationPatientSchema = new mongoose.Schema(
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
    vaccineName: {
      type: String,
      trim: true,
      required: true,
    },
    dateGiven: {
      type: Date,
      default: Date.now,
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

immunizationPatientSchema.index({ patientId: 1, doctorId: 1 });
immunizationPatientSchema.index({ vaccineName: "text" });
immunizationPatientSchema.index({ createdByClinicId: 1, createdAt: -1 });
immunizationPatientSchema.index({ sharedWith: 1 });

immunizationPatientSchema.pre("validate", function (next) {
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

const immunizationPatient =
  mongoose.models.immunizationPatient ||
  mongoose.model("immunizationPatient", immunizationPatientSchema);

export default immunizationPatient;
