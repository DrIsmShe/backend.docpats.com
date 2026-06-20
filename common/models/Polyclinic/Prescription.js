import mongoose from "mongoose";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  Prescription — рецепт (бланк назначений)
 *  Sprint 2 Phase 2C (Medical Workflow) — Stage 2 #4
 *
 *  WHO Good Prescribing item structure (Stage 2 #4 revision, 2 Jun 2026):
 *   Каждая позиция бланка следует WHO Guide to Good Prescribing:
 *     - inn        — МНН (международное непатентованное название). ОБЯЗАТЕЛЬНО.
 *                    WHO: выписывать по генерике, не по торговой марке.
 *     - brandName  — торговое название (опц., если важно конкретное)
 *     - strength   — сила препарата ("10 мг", "500 мг/5 мл")
 *     - form       — лекарственная форма (enum)
 *     - route      — путь введения (enum: per os / topical / IM / IV / ...)
 *     - dose       — разовая доза ("1 таблетка", "5 мл")
 *     - frequency  — частота ("2 раза в день")
 *     - duration   — длительность ("7 дней")
 *     - quantity   — общее количество на курс ("№20")
 *     - prn        — по требованию (pro re nata)
 *     - instructions — указания пациенту
 *
 *  АРХИТЕКТУРА (повторяет newPatientMedicalHistory / UMR):
 *   - Standalone-сущность с ОПЦИОНАЛЬНОЙ привязкой к encounter (encounterId).
 *   - Consent через существующий scope "encounters" (НЕ отдельный scope).
 *   - Авторство: createdBy (User) XOR createdByEmployee (ClinicEmployee).
 *   - sharedWith — клиники, которым пациент дал доступ к этому рецепту.
 *   - PHI хранится PLAINTEXT — консистентно с medical-доменом.
 *
 *  FSM (без draft): active → cancelled | completed
 *  RBAC выписки: doctor + owner/admin.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const PRESCRIPTION_STATUSES = ["active", "cancelled", "completed"];

// Лекарственная форма — enum (для фильтров и PDF-вёрстки).
const DRUG_FORMS = [
  "tablet", // таблетки
  "capsule", // капсулы
  "syrup", // сироп
  "spray", // спрей (назальный — частый ЛОР-кейс)
  "drops", // капли (ушные/назальные/глазные)
  "ointment", // мазь
  "injection", // инъекции
  "inhaler", // ингалятор
  "suppository", // свечи
  "solution", // раствор
  "powder", // порошок
  "other",
];

// Путь введения (WHO route of administration). Free-text "other" на хвосте.
const DRUG_ROUTES = [
  "oral", // перорально (per os)
  "topical", // местно/наружно
  "intramuscular", // в/м
  "intravenous", // в/в
  "subcutaneous", // п/к
  "inhalation", // ингаляционно
  "nasal", // интраназально (ЛОР)
  "otic", // в ухо (ЛОР)
  "ophthalmic", // в глаз
  "rectal", // ректально
  "sublingual", // под язык
  "other",
];

// ── Позиция бланка (один препарат) — WHO Good Prescribing ────────
const prescriptionItemSchema = new mongoose.Schema(
  {
    inn: { type: String, required: true, trim: true }, // МНН — WHO: генерика обязательна
    brandName: { type: String, trim: true, default: "" }, // торговое (опц.)
    strength: { type: String, trim: true, default: "" }, // сила: "10 мг", "500 мг/5 мл"
    form: { type: String, enum: DRUG_FORMS, default: "other" }, // лекформа
    route: { type: String, enum: DRUG_ROUTES, default: "oral" }, // путь введения
    dose: { type: String, trim: true, default: "" }, // разовая доза: "1 таблетка"
    frequency: { type: String, trim: true, default: "" }, // "2 раза в день"
    duration: { type: String, trim: true, default: "" }, // "7 дней"
    quantity: { type: String, trim: true, default: "" }, // на курс: "№20" (опц.)
    prn: { type: Boolean, default: false }, // по требованию
    instructions: { type: String, trim: true, default: "" }, // указания пациенту
  },
  { _id: true },
);

const prescriptionSchema = new mongoose.Schema(
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

    // ── СВЯЗЬ С ПАЦИЕНТОМ (как encounter) ─────────────────────────
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

    // ── ОПЦИОНАЛЬНАЯ ПРИВЯЗКА К ВИЗИТУ ────────────────────────────
    encounterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "newPatientMedicalHistory",
      default: null,
      index: true,
    },

    // ── СОДЕРЖИМОЕ БЛАНКА ─────────────────────────────────────────
    items: {
      type: [prescriptionItemSchema],
      default: [],
    },
    generalNotes: { type: String, trim: true, default: "" },
    diagnosis: {
      code: { type: String, trim: true, default: "" },
      codeTitle: { type: String, trim: true, default: "" },
      text: { type: String, trim: true, default: "" },
    },

    // ── FSM ───────────────────────────────────────────────────────
    status: {
      type: String,
      enum: PRESCRIPTION_STATUSES,
      default: "active",
      required: true,
      index: true,
    },
    issuedAt: { type: Date, default: Date.now },
    issuedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    issuedByEmployeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClinicEmployee",
      default: null,
    },
    closedAt: { type: Date, default: null },
    closedReason: { type: String, trim: true, default: null },

    // ── CONSENT / SHARING (UMR) ───────────────────────────────────
    sharedWith: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Clinic" }],
      default: [],
    },

    // ── AUDIT TRAIL (как encounter.history) ───────────────────────
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
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// ── ИНДЕКСЫ ──────────────────────────────────────────────────────
prescriptionSchema.index({ patientType: 1, patientRef: 1 });
prescriptionSchema.index({ createdByClinicId: 1, createdAt: -1 });
prescriptionSchema.index({ sharedWith: 1 });
prescriptionSchema.index({ patientRef: 1, status: 1, createdAt: -1 });
prescriptionSchema.index({ "diagnosis.code": 1 });

// ── ВАЛИДАЦИЯ ────────────────────────────────────────────────────
prescriptionSchema.pre("validate", function (next) {
  // 1. Ровно один автор: createdBy XOR createdByEmployee
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
        "createdByClinicId is required when prescription is created by ClinicEmployee.",
      ),
    );
  }

  // 2. Бланк должен иметь хотя бы одну позицию с МНН (WHO: INN обязателен)
  if (this.isNew) {
    const validItems = (this.items || []).filter(
      (it) => it.inn && it.inn.trim(),
    );
    if (validItems.length === 0) {
      return next(
        new Error(
          "Prescription requires at least one item with an INN (drug name).",
        ),
      );
    }
  }

  // 3. issuedBy* — ровно один (нет draft → всегда issued)
  if (this.isNew) {
    if (!this.issuedByUserId && !this.issuedByEmployeeId) {
      return next(
        new Error(
          "issuedByUserId or issuedByEmployeeId is required (prescriptions are issued on creation).",
        ),
      );
    }
  }

  // 4. Терминальный статус требует closedAt
  if (
    (this.status === "cancelled" || this.status === "completed") &&
    !this.closedAt
  ) {
    return next(
      new Error(`status=${this.status} requires closedAt timestamp.`),
    );
  }

  next();
});

const Prescription =
  mongoose.models.Prescription ||
  mongoose.model("Prescription", prescriptionSchema);

export const PRESCRIPTION_STATUS_VALUES = PRESCRIPTION_STATUSES;
export const PRESCRIPTION_DRUG_FORMS = DRUG_FORMS;
export const PRESCRIPTION_DRUG_ROUTES = DRUG_ROUTES;

export default Prescription;
