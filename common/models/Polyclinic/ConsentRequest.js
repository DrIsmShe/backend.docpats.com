// common/models/Polyclinic/ConsentRequest.js
//
// ConsentRequest — запрос клиники к пациенту на получение consent.
//
// Sprint 3.2 (Pull Consent, 31 May 2026).
//
// ─────────────────────────────────────────────────────────────────────────────
//  АРХИТЕКТУРА
// ─────────────────────────────────────────────────────────────────────────────
//
// Sprint 3.1 (Push)  : пациент сам в кабинете даёт consent клинике.
// Sprint 3.2 (Pull)  : клиника отправляет запрос пациенту → пациент решает.
//
//   1. Сотрудник клиники открывает карту ClinicPatient (линкованную с User).
//   2. Нажимает [Запросить доступ] → выбирает scopes → submit.
//   3. Создаётся ConsentRequest со status="pending".
//   4. Пациент получает in-app notification + email (без PHI).
//   5. Пациент в кабинете approve/reject.
//   6. Approve → создаётся PatientConsent + status="approved" + resultingConsentId.
//      Reject  → status="rejected" + respondedNote.
//   7. Cron expireStaleConsentRequests: status="pending" + expiresAt<now → "expired".
//
// ─────────────────────────────────────────────────────────────────────────────
//  СВЯЗЬ С PatientConsent
// ─────────────────────────────────────────────────────────────────────────────
//
// • ConsentRequest хранит ИСТОРИЮ запросов (включая отклонённые/истёкшие).
// • PatientConsent хранит ФАКТ доступа.
// • При approve service создаёт PatientConsent ИДЕНТИЧНО Sprint 3.1
//   (purpose="treatment", signatureMethod="electronic", signedByPatient=userId).
// • resultingConsentId — линк на созданный PatientConsent.
//
// ─────────────────────────────────────────────────────────────────────────────
//  RATE LIMITING
// ─────────────────────────────────────────────────────────────────────────────
//
// Через статический метод countActivePending(patientRef, clinicId):
// если уже 3 pending запроса от одной (clinic, patient) — service отказывает
// в создании нового. Защищает пациента от спама запросами.
//
// ─────────────────────────────────────────────────────────────────────────────
//  ВНИМАНИЕ
// ─────────────────────────────────────────────────────────────────────────────
//
// • status — FSM: pending → approved | rejected | expired | cancelled.
//   Из терминальных состояний переходов НЕТ. Терминальные документы
//   остаются в БД для audit trail.
//
// • Не шифруем поля — нет PHI (только scopes объект и system fields).
//
// • requestedScopes — что именно ХОЧЕТ клиника. Пациент при approve
//   может выбрать ПОДМНОЖЕСТВО (granular UI). Сохраняем оба:
//   requestedScopes (что просили) + approvedScopes (что одобрено)
//   для audit и для compliance dashboard "что просили vs что дали".
//
// ─────────────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";

const { Schema } = mongoose;

const REQUEST_STATUSES = [
  "pending", // ожидает решения пациента
  "approved", // одобрен, создан PatientConsent
  "rejected", // отклонён пациентом
  "expired", // истёк срок (cron)
  "cancelled", // отозван клиникой до решения пациента
];

const PATIENT_TYPE_MODELS = [
  "DoctorPrivatePatient",
  "NewPatientPolyclinic",
  "ClinicPatient",
];

// MVP — единственная цель. Расширим в Sprint 3.3+.
const REQUEST_PURPOSES = ["treatment"];

// Срок жизни pending запроса.
const DEFAULT_TTL_DAYS = 30;

// Максимум активных pending запросов от одной (clinic, patient).
const MAX_ACTIVE_PENDING = 3;

const ConsentRequestSchema = new Schema(
  {
    // ═══════════ КТО (пациент) ═══════════
    patientRef: {
      type: Schema.Types.ObjectId,
      required: true,
      refPath: "patientTypeModel",
    },
    patientTypeModel: {
      type: String,
      required: true,
      enum: PATIENT_TYPE_MODELS,
    },
    // Денормализован для list-запросов "все pending для меня"
    patientUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true, // Sprint 3.2 MVP — только для linked patients
    },

    // ═══════════ КТО ЗАПРАШИВАЕТ (клиника) ═══════════
    clinicId: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
    },
    // Конкретный сотрудник, инициировавший запрос
    requestedBy: {
      userId: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      employeeId: {
        type: Schema.Types.ObjectId,
        ref: "ClinicEmployee",
        default: null,
      },
    },

    // ═══════════ ЦЕЛЬ ═══════════
    purpose: {
      type: String,
      enum: REQUEST_PURPOSES,
      default: "treatment",
      required: true,
    },

    // ═══════════ SCOPES ═══════════
    // Что клиника ХОЧЕТ получить.
    requestedScopes: {
      encounters: { type: Boolean, default: false },
      allergies: { type: Boolean, default: false },
      chronicDiseases: { type: Boolean, default: false },
      operations: { type: Boolean, default: false },
      familyHistory: { type: Boolean, default: false },
      immunization: { type: Boolean, default: false },
      imaging: { type: Boolean, default: false },
    },
    // Что пациент ОДОБРИЛ (заполняется при approve, может быть подмножеством).
    approvedScopes: {
      encounters: { type: Boolean, default: false },
      allergies: { type: Boolean, default: false },
      chronicDiseases: { type: Boolean, default: false },
      operations: { type: Boolean, default: false },
      familyHistory: { type: Boolean, default: false },
      immunization: { type: Boolean, default: false },
      imaging: { type: Boolean, default: false },
    },

    // ═══════════ СТАТУС (FSM) ═══════════
    status: {
      type: String,
      enum: REQUEST_STATUSES,
      default: "pending",
      required: true,
      index: true,
    },

    // ═══════════ TIMESTAMPS ═══════════
    requestedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    respondedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true, // обязательно — даже bessrochnye имеют срок
    },

    // ═══════════ RESPONSE FIELDS ═══════════
    // Опциональная заметка от пациента при reject ("я уже не лечусь там")
    respondedNote: {
      type: String,
      default: null,
      maxlength: 500,
      trim: true,
    },
    // Ссылка на созданный PatientConsent (после approve)
    resultingConsentId: {
      type: Schema.Types.ObjectId,
      ref: "PatientConsent",
      default: null,
    },

    // ═══════════ ОПЦИОНАЛЬНОЕ СООБЩЕНИЕ ОТ КЛИНИКИ ═══════════
    // "Доктор хочет видеть ваши аллергии перед операцией"
    // Без PHI. Отображается пациенту в UI запроса.
    message: {
      type: String,
      default: null,
      maxlength: 500,
      trim: true,
    },
  },
  {
    timestamps: true,
    strict: true,
    collection: "consent_requests",
  },
);

// ─────────────────────────────────────────────────────────────────────────────
//  ИНДЕКСЫ
// ─────────────────────────────────────────────────────────────────────────────

// Самый частый запрос: "все pending запросы для пациента"
ConsentRequestSchema.index({ patientUserId: 1, status: 1, createdAt: -1 });

// Список запросов клиники на пациента (для clinic UI history)
ConsentRequestSchema.index({ clinicId: 1, patientRef: 1, createdAt: -1 });

// Rate limit check: active pending для пары (clinic, patient)
ConsentRequestSchema.index({ clinicId: 1, patientRef: 1, status: 1 });

// Cron: expired stale
ConsentRequestSchema.index({ status: 1, expiresAt: 1 });

// ─────────────────────────────────────────────────────────────────────────────
//  ВАЛИДАЦИЯ
// ─────────────────────────────────────────────────────────────────────────────

ConsentRequestSchema.pre("validate", function (next) {
  // 1. requestedScopes — хотя бы один должен быть true
  if (this.isNew) {
    const anyScope = Object.values(
      this.requestedScopes?.toObject?.() || this.requestedScopes || {},
    ).some(Boolean);
    if (!anyScope) {
      return next(new Error("At least one requested scope must be true."));
    }
  }

  // 2. expiresAt > requestedAt
  if (
    this.expiresAt &&
    this.requestedAt &&
    this.expiresAt <= this.requestedAt
  ) {
    return next(new Error("expiresAt must be after requestedAt."));
  }

  // 3. Терминальные статусы должны иметь respondedAt
  const terminal = ["approved", "rejected", "expired", "cancelled"];
  if (terminal.includes(this.status) && !this.respondedAt) {
    return next(new Error(`status=${this.status} requires respondedAt`));
  }

  // 4. approved требует resultingConsentId (заполняется в service)
  if (this.status === "approved" && !this.resultingConsentId) {
    return next(new Error("status=approved requires resultingConsentId"));
  }

  next();
});

// ─────────────────────────────────────────────────────────────────────────────
//  AUTO-RULES
// ─────────────────────────────────────────────────────────────────────────────

// При создании — если expiresAt не задан, ставим +30 дней
ConsentRequestSchema.pre("save", function (next) {
  if (this.isNew && !this.expiresAt) {
    const expires = new Date(this.requestedAt.getTime());
    expires.setUTCDate(expires.getUTCDate() + DEFAULT_TTL_DAYS);
    this.expiresAt = expires;
  }
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
//  STATIC METHODS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Подсчёт активных pending запросов для пары (clinic, patient).
 * Используется для rate limiting в service-слое перед создание.
 *
 * @returns {Promise<number>}
 */
ConsentRequestSchema.statics.countActivePending = function (
  patientRef,
  clinicId,
) {
  return this.countDocuments({
    patientRef,
    clinicId,
    status: "pending",
  });
};

/**
 * Все pending запросы для пациента (для UI кабинета пациента).
 */
ConsentRequestSchema.statics.listPendingForPatient = function (
  patientUserId,
  opts = {},
) {
  const { limit = 50 } = opts;
  return this.find({ patientUserId, status: "pending" })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("clinicId", "name slug logoUrl")
    .exec();
};

/**
 * История запросов клиники на одного пациента (для clinic UI).
 */
ConsentRequestSchema.statics.listByClinicAndPatient = function (
  clinicId,
  patientRef,
  opts = {},
) {
  const { limit = 100 } = opts;
  return this.find({ clinicId, patientRef })
    .sort({ createdAt: -1 })
    .limit(limit)
    .exec();
};

/**
 * Все pending запросы со status="pending" + expiresAt<now (для cron).
 */
ConsentRequestSchema.statics.findStalePending = function () {
  const now = new Date();
  return this.find({
    status: "pending",
    expiresAt: { $lte: now },
  })
    .limit(500)
    .exec();
};

// ─────────────────────────────────────────────────────────────────────────────
//  EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export const CONSENT_REQUEST_STATUSES = REQUEST_STATUSES;
export const CONSENT_REQUEST_PURPOSES = REQUEST_PURPOSES;
export const CONSENT_REQUEST_DEFAULT_TTL_DAYS = DEFAULT_TTL_DAYS;
export const CONSENT_REQUEST_MAX_ACTIVE_PENDING = MAX_ACTIVE_PENDING;

const ConsentRequest =
  mongoose.models.ConsentRequest ||
  mongoose.model("ConsentRequest", ConsentRequestSchema);

export default ConsentRequest;
