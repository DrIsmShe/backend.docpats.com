// common/models/Polyclinic/PatientConsent.js
//
// PatientConsent — глобальное согласие пациента на доступ конкретной
// клиники к его медицинским данным.
//
// Sprint 2 Phase 1 (UMR — Unified Medical Records).
//
// ─────────────────────────────────────────────────────────────────────────────
//  АРХИТЕКТУРА ДОСТУПА К ДАННЫМ ПАЦИЕНТА
// ─────────────────────────────────────────────────────────────────────────────
//
// У clinic-medical модуля три независимых механизма доступа:
//
// 1. ОЫНЕР — запись создана этой клиникой
//    record.createdByClinicId === currentClinic._id
//    → полный доступ всегда.
//
// 2. PER-RECORD SHARING — пациент явно открыл одну запись
//    record.sharedWith.includes(currentClinic._id)
//    → доступ только к этой записи.
//
// 3. ГЛОБАЛЬНЫЙ CONSENT — пациент дал общий доступ типам данных
//    PatientConsent { patientRef, clinicId: currentClinic._id, scopes: {...} }
//    → доступ ко всем записям типов где scope=true.
//
// Псевдокод проверки в read-контроллере:
//   if (record.createdByClinicId.equals(currentClinic._id)) return ALLOW;
//   if (record.sharedWith.some(c => c.equals(currentClinic._id))) return ALLOW;
//   if (await PatientConsent.checkScope(patientRef, currentClinic._id, scope)) return ALLOW;
//   return DENY;
//
// ─────────────────────────────────────────────────────────────────────────────
//  ЖИЗНЕННЫЙ ЦИКЛ CONSENT
// ─────────────────────────────────────────────────────────────────────────────
//
// 1. Пациент подписывает (бумага/электронно/ASAN İmza) → запись создаётся
//    через PatientConsent.create(...) (см. consent.service.js)
//    signedAt = now, revokedAt = null, expiresAt = null или дата.
//
// 2. Активный consent: revokedAt === null AND (expiresAt === null OR expiresAt > now)
//    Helper: PatientConsent.isActive(doc) и static findActive(...)
//
// 3. Истечение: cron-задача отмечает expired consent'ы.
//    Альтернатива: проверка expiresAt > now на каждом read (без cron).
//
// 4. Отзыв: пациент через свой кабинет отзывает consent.
//    revokedAt = now, revokedReason = string.
//    Доступ прекращается ДЛЯ БУДУЩИХ чтений. Прошлый audit log остаётся.
//
// 5. Повторная выдача: новый отдельный документ PatientConsent.
//    История всех consent'ов сохраняется.
//
// ─────────────────────────────────────────────────────────────────────────────
//  ВНИМАНИЕ
// ─────────────────────────────────────────────────────────────────────────────
//
// • Не используем уникальный constraint на (patientRef, clinicId) — у пациента
//   может быть несколько consent'ов клинике (старый отозванный + новый активный).
//   Уникальность проверяется на уровне service-слоя (consent.service.js).
//
// • Не шифруем поля этой модели — здесь нет PHI. Это метаданные о доступе.
//
// • signedDocumentUrl — это R2-ссылка на скан подписанного бумажного consent.
//   Сами медицинские данные в этом документе НЕ хранятся.
//
// ─────────────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";

const { Schema } = mongoose;

const SIGNATURE_METHODS = [
  "electronic", // подпись через UI кабинета пациента
  "paper_scan", // бумажная подпись отсканирована и загружена клиникой
  "asan_imza", // государственная азербайджанская ЭЦП
  "verbal_recorded", // устное согласие, записано (телефон/видео-приём)
];

const CONSENT_PURPOSES = [
  "treatment", // основное лечение в этой клинике
  "referral", // разовая консультация / направление к специалисту
  "second_opinion", // второе мнение от другой клиники
  "emergency", // экстренная помощь — авто-истечение через 7 дней
  "research", // деперсонализированные данные для исследований
];

const PATIENT_TYPE_MODELS = [
  "DoctorPrivatePatient",
  "NewPatientPolyclinic",
  "ClinicPatient",
];

// Срок жизни emergency consent — 7 дней.
const EMERGENCY_TTL_DAYS = 7;

const PatientConsentSchema = new Schema(
  {
    // ═══════════ КТО (пациент) ═══════════
    // Полиморфная ссылка на пациента. patientTypeModel определяет коллекцию.
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

    // Денормализованный userId пациента (если есть линк с DocPats-аккаунтом).
    // Удобно для запроса "все consent'ы данного User'а".
    // null для private/provisional пациентов без линка.
    patientUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // ═══════════ КОМУ (клиника) ═══════════
    clinicId: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
    },

    // ═══════════ ЦЕЛЬ ═══════════
    purpose: {
      type: String,
      enum: CONSENT_PURPOSES,
      required: true,
    },

    // ═══════════ SCOPES (что разрешено читать) ═══════════
    // Объект с boolean-флагами по типам данных. По умолчанию ничего не открыто.
    // Контроллер при чтении ресурса проверяет соответствующий scope.
    scopes: {
      encounters: { type: Boolean, default: false },
      allergies: { type: Boolean, default: false },
      chronicDiseases: { type: Boolean, default: false },
      operations: { type: Boolean, default: false },
      familyHistory: { type: Boolean, default: false },
      immunization: { type: Boolean, default: false },
      imaging: { type: Boolean, default: false },
    },

    // ═══════════ ПОДПИСЬ ═══════════
    signedAt: {
      type: Date,
      required: true,
    },

    // Кто подписал. Обычно сам пациент (если у него есть DocPats-аккаунт).
    // Может быть null для бумажной подписи или verbal_recorded — тогда
    // обязательно заполнен signedDocumentUrl или указан клинический сотрудник
    // который зафиксировал устное согласие через witnessedByEmployee.
    signedByPatient: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // Сотрудник клиники, который засвидетельствовал подпись (для paper/verbal).
    // Обязателен если signedByPatient === null.
    witnessedByEmployee: {
      type: Schema.Types.ObjectId,
      ref: "ClinicEmployee",
      default: null,
    },

    // R2-ссылка на скан/PDF подписанного документа (для paper_scan).
    // Юридическое доказательство при суде.
    signedDocumentUrl: {
      type: String,
      default: null,
      trim: true,
    },

    // Метод подписи.
    signatureMethod: {
      type: String,
      enum: SIGNATURE_METHODS,
      required: true,
    },

    // Технический контекст для электронной подписи (forensics).
    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null, maxlength: 500 },

    // ═══════════ СРОК ДЕЙСТВИЯ ═══════════
    // null = бессрочно.
    // Для emergency покрывает pre-save hook (+7 дней от signedAt).
    expiresAt: {
      type: Date,
      default: null,
    },

    // ═══════════ ОТЗЫВ ═══════════
    revokedAt: {
      type: Date,
      default: null,
    },
    revokedReason: {
      type: String,
      default: null,
      maxlength: 500,
    },
    // Кто отозвал. Обычно сам пациент. Может быть admin (compliance issue).
    revokedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // ═══════════ NOTES (произвольная заметка от клиники) ═══════════
    // Не PHI. Например "Подписан при первом визите 26.05.2026, оригинал в карте N123".
    notes: {
      type: String,
      default: null,
      maxlength: 2000,
    },
  },
  {
    timestamps: true,
    strict: true,
    collection: "patient_consents",
  },
);

// ─────────────────────────────────────────────────────────────────────────────
//  ИНДЕКСЫ
// ─────────────────────────────────────────────────────────────────────────────

// Самый частый запрос: "есть ли активный consent пациента у этой клиники"
PatientConsentSchema.index({
  patientRef: 1,
  clinicId: 1,
  revokedAt: 1,
  createdAt: -1,
});

// Список всех consent'ов одного пациента (для UI кабинета пациента)
PatientConsentSchema.index({ patientUserId: 1, createdAt: -1 });

// Список всех пациентов давших согласие конкретной клинике
PatientConsentSchema.index({ clinicId: 1, createdAt: -1 });

// Для cron'а истечения сроков
PatientConsentSchema.index({ expiresAt: 1, revokedAt: 1 });

// ─────────────────────────────────────────────────────────────────────────────
//  ВАЛИДАЦИЯ
// ─────────────────────────────────────────────────────────────────────────────

PatientConsentSchema.pre("validate", function (next) {
  // 1. Подписант обязателен в одном из двух мест
  if (!this.signedByPatient && !this.witnessedByEmployee) {
    return next(
      new Error(
        "Consent must have either signedByPatient (User) or witnessedByEmployee (ClinicEmployee).",
      ),
    );
  }

  // 2. paper_scan требует signedDocumentUrl
  if (this.signatureMethod === "paper_scan" && !this.signedDocumentUrl) {
    return next(
      new Error("paper_scan signature method requires signedDocumentUrl."),
    );
  }

  // 3. revokedAt > signedAt
  if (this.revokedAt && this.signedAt && this.revokedAt < this.signedAt) {
    return next(new Error("revokedAt cannot be before signedAt."));
  }

  // 4. expiresAt > signedAt
  if (this.expiresAt && this.signedAt && this.expiresAt <= this.signedAt) {
    return next(new Error("expiresAt must be after signedAt."));
  }

  // 5. Хотя бы один scope true для активного consent (при создании)
  if (this.isNew && !this.revokedAt) {
    const anyScope = Object.values(
      this.scopes?.toObject?.() || this.scopes || {},
    ).some(Boolean);
    if (!anyScope) {
      return next(
        new Error("At least one scope must be true for an active consent."),
      );
    }
  }

  next();
});

// ─────────────────────────────────────────────────────────────────────────────
//  AUTO-RULES
// ─────────────────────────────────────────────────────────────────────────────

// emergency consent → expiresAt = signedAt + 7 дней (если не задано вручную)
PatientConsentSchema.pre("save", function (next) {
  if (this.isNew && this.purpose === "emergency" && !this.expiresAt) {
    const expires = new Date(this.signedAt.getTime());
    expires.setUTCDate(expires.getUTCDate() + EMERGENCY_TTL_DAYS);
    this.expiresAt = expires;
  }
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
//  STATIC METHODS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Проверка: активен ли consent (не отозван, не истёк).
 * Чистая функция без обращения к БД — принимает уже найденный документ.
 *
 * @param {object} doc — документ PatientConsent (or null/undefined)
 * @returns {boolean}
 */
PatientConsentSchema.statics.isActive = function (doc) {
  if (!doc) return false;
  if (doc.revokedAt) return false;
  if (doc.expiresAt && doc.expiresAt <= new Date()) return false;
  return true;
};

/**
 * Найти последний активный consent пациента у клиники.
 *
 * @param {ObjectId} patientRef
 * @param {ObjectId} clinicId
 * @returns {Promise<doc|null>}
 */
PatientConsentSchema.statics.findActive = function (patientRef, clinicId) {
  const now = new Date();
  return this.findOne({
    patientRef,
    clinicId,
    revokedAt: null,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
  })
    .sort({ createdAt: -1 })
    .exec();
};

/**
 * Быстрая проверка scope: разрешён ли конкретный тип данных.
 *
 * @param {ObjectId} patientRef
 * @param {ObjectId} clinicId
 * @param {string} scope — "encounters" | "allergies" | "chronicDiseases" | ...
 * @returns {Promise<boolean>}
 */
PatientConsentSchema.statics.checkScope = async function (
  patientRef,
  clinicId,
  scope,
) {
  const consent = await this.findActive(patientRef, clinicId);
  if (!consent) return false;
  return Boolean(consent.scopes?.[scope]);
};

/**
 * Все consent'ы пациента (для UI кабинета).
 */
PatientConsentSchema.statics.listByPatient = function (patientRef, opts = {}) {
  const { limit = 50, includeRevoked = true } = opts;
  const filter = { patientRef };
  if (!includeRevoked) filter.revokedAt = null;
  return this.find(filter).sort({ createdAt: -1 }).limit(limit).exec();
};

/**
 * Все пациенты давшие согласие конкретной клинике.
 */
PatientConsentSchema.statics.listByClinic = function (clinicId, opts = {}) {
  const { limit = 100, onlyActive = false } = opts;
  const filter = { clinicId };
  if (onlyActive) {
    const now = new Date();
    filter.revokedAt = null;
    filter.$or = [{ expiresAt: null }, { expiresAt: { $gt: now } }];
  }
  return this.find(filter).sort({ createdAt: -1 }).limit(limit).exec();
};

// ─────────────────────────────────────────────────────────────────────────────
//  EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export const PATIENT_CONSENT_SCOPES = [
  "encounters",
  "allergies",
  "chronicDiseases",
  "operations",
  "familyHistory",
  "immunization",
  "imaging",
];

export { SIGNATURE_METHODS, CONSENT_PURPOSES, EMERGENCY_TTL_DAYS };

const PatientConsent =
  mongoose.models.PatientConsent ||
  mongoose.model("PatientConsent", PatientConsentSchema);

export default PatientConsent;
