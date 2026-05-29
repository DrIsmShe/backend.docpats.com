import mongoose from "mongoose";

/**
 * 🔪 operationsPatient — перенесённые операции пациента
 *  Sprint 2 Phase 1 (UMR) — patient-attribute шаблон
 *
 *  ⚠️ ИСПРАВЛЕНО ПРИ РЕВЬЮ:
 *
 *  БАГ #1 — имя модели:
 *    Было:  mongoose.model("operationsPatientModel", schema)
 *    Стало: mongoose.model("operationsPatient", schema)
 *    Причина: в newPatientMedicalHistory ссылка `ref: "operationsPatient"`,
 *    а модель регистрировалась под именем "operationsPatientModel".
 *    .populate("operations") тихо ломался — возвращал [].
 *    → НУЖЕН GREP по коду: grep -rn '"operationsPatientModel"' server/
 *
 *  БАГ #2 — некорректный индекс:
 *    Было:  schema.index({ fullName: "text", phone: 1 })
 *    Полей fullName и phone в схеме НЕТ — копипаст из patient-схемы.
 *    Удалено. Заменено на text-индекс по content (как у остальных).
 *
 *  UMR-поля: createdByEmployee, createdByClinicId, sharedWith
 */

const operationsPatientSchema = new mongoose.Schema(
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

operationsPatientSchema.index({ patientId: 1, doctorId: 1 });
operationsPatientSchema.index({ content: "text" });
operationsPatientSchema.index({ createdByClinicId: 1, createdAt: -1 });
operationsPatientSchema.index({ sharedWith: 1 });

operationsPatientSchema.pre("validate", function (next) {
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

// ⚠️ ИСПРАВЛЕНО: имя модели "operationsPatient" — совпадает с ref в encounter
const operationsPatient =
  mongoose.models.operationsPatient ||
  mongoose.model("operationsPatient", operationsPatientSchema);

export default operationsPatient;
