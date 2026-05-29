import mongoose from "mongoose";

/**
 * 📋 chronicDiseasesPatient — хронические заболевания пациента
 *  Sprint 2 Phase 1 (UMR) — стандартный patient-attribute шаблон
 *
 *  UMR-поля:
 *   - createdByEmployee   — автор-сотрудник клиники
 *   - createdByClinicId   — клиника-автор. null = фрилансер
 *   - sharedWith          — клиники с доступом
 *
 *  Валидация:
 *   - Ровно один создатель: doctorId (User) ИЛИ createdByEmployee
 *   - Если createdByEmployee — обязателен createdByClinicId
 */

const chronicDiseasesPatientSchema = new mongoose.Schema(
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
    content: {
      type: String,
      trim: true,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

chronicDiseasesPatientSchema.index({ patientId: 1, doctorId: 1 });
chronicDiseasesPatientSchema.index({ content: "text" });
chronicDiseasesPatientSchema.index({ createdByClinicId: 1, createdAt: -1 });
chronicDiseasesPatientSchema.index({ sharedWith: 1 });

chronicDiseasesPatientSchema.pre("validate", function (next) {
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

const chronicDiseasesPatient =
  mongoose.models.chronicDiseasesPatient ||
  mongoose.model("chronicDiseasesPatient", chronicDiseasesPatientSchema);

export default chronicDiseasesPatient;
