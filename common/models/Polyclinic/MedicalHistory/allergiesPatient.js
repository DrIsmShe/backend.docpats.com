import mongoose from "mongoose";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  allergiesPatient — атрибут пациента (аллергия)
 *  Sprint 2 Phase 1 (UMR)
 *
 *  Шаблон одинаковый для всех patient-attribute моделей:
 *    chronicDiseasesPatient, familyHistoryOfDiseasePatient,
 *    operationsPatient, immunizationPatient
 *
 *  Что добавлено:
 *   - createdByEmployee   — автор-сотрудник клиники, альтернатива doctorId
 *   - createdByClinicId   — клиника-автор. null = фрилансер.
 *   - sharedWith          — клиники, которым пациент открыл доступ
 *
 *  ⚠️ status / signedBy НЕ добавляются — это не encounter,
 *     атрибуты пациента не подписывают.
 *
 *  Валидация:
 *   - Ровно один создатель: doctorId (User) ИЛИ createdByEmployee (Employee)
 *   - Если createdByEmployee — обязателен createdByClinicId
 * ─────────────────────────────────────────────────────────────────────────────
 */

const allergiesPatientSchema = new mongoose.Schema(
  {
    // Пациент
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NewPatientPolyclinic",
      required: true,
      index: true,
    },

    // ──────────────────────────────────────────────────────────────
    //  АВТОРСТВО (UMR)
    // ──────────────────────────────────────────────────────────────

    // Автор-фрилансер (User-врач). Legacy-имя doctorId сохранено.
    // Обязателен ТОЛЬКО если createdByEmployee нет.
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // Автор-сотрудник клиники.
    createdByEmployee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClinicEmployee",
      default: null,
    },

    // Клиника-автор. null = фрилансер.
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

// ─────────────────────────────────────────────────────────────────────────────
//  ИНДЕКСЫ
// ─────────────────────────────────────────────────────────────────────────────

allergiesPatientSchema.index({ createdByClinicId: 1, createdAt: -1 });
allergiesPatientSchema.index({ sharedWith: 1 });

// ─────────────────────────────────────────────────────────────────────────────
//  ВАЛИДАЦИЯ — ровно один создатель
// ─────────────────────────────────────────────────────────────────────────────

allergiesPatientSchema.pre("validate", function (next) {
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

const allergiesPatientModel = mongoose.model(
  "AllergiesPatient",
  allergiesPatientSchema,
);

export default allergiesPatientModel;
