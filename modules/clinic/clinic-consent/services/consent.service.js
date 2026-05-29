// modules/clinic/clinic-consent/services/consent.service.js
//
// Service-обёртка для всех операций с PatientConsent.
// Каждая операция автоматически пишет HIPAA audit log через auditService.
//
// Sprint 2 Phase 1 (UMR).
//
// ─────────────────────────────────────────────────────────────────────────────
//  ИСПОЛЬЗОВАНИЕ ИЗ КОНТРОЛЛЕРОВ
// ─────────────────────────────────────────────────────────────────────────────
//
// Контроллер передаёт ТОЛЬКО payload + actor + http-context.
// Аудит и валидация — внутри service'а.
//
//   // grant
//   const consent = await consentService.grantConsent({
//     payload: { patientRef, patientTypeModel, clinicId, purpose, scopes, ... },
//     actor: { userId, email, role },
//     context: { ipAddress, userAgent, sessionId, requestId },
//   });
//
//   // checkScope (Express middleware ИЛИ inline в read-контроллере)
//   const allowed = await consentService.checkScope(patientRef, clinicId, "allergies");
//   if (!allowed) return res.status(403).json({ message: "No consent" });
//
//   // revoke
//   await consentService.revokeConsent({
//     consentId,
//     reason: "Patient request",
//     actor: { userId, email, role },
//     context: { ... },
//   });
//
// ─────────────────────────────────────────────────────────────────────────────
//  ВНИМАНИЕ
// ─────────────────────────────────────────────────────────────────────────────
//
// • Все методы НИКОГДА не падают молча. Если запись consent'а в БД упала —
//   throw ошибки контроллеру. Если audit log упал — только log warning,
//   основная операция не блокируется (fire-and-forget философия audit).
//
// • checkScope() — read-only, тоже пишет audit (patient.consent.check), но
//   ТОЛЬКО при denied. Логировать каждый успешный check = шум.
//
// • revokeConsent работает идемпотентно — повторный revoke возвращает текущее
//   состояние без ошибки.
//
// ─────────────────────────────────────────────────────────────────────────────

import PatientConsent from "../../../../common/models/Polyclinic/PatientConsent.js";
import auditService from "../../../audit/services/audit.service.js";

const RESOURCE_TYPE = "patient-consent";

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Безопасный вызов audit — никогда не пробрасывает ошибку наверх.
 */
function safeAudit(payload) {
  try {
    auditService.recordActionAsync(payload);
  } catch (err) {
    console.warn("[consent.service] audit failed:", err.message);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   GRANT — пациент даёт consent клинике
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Создать новую запись PatientConsent.
 *
 * @param {object} args
 * @param {object} args.payload — поля PatientConsent (см. модель)
 * @param {object} args.actor   — { userId, email, role }
 * @param {object} args.context — { ipAddress, userAgent, sessionId, requestId }
 * @returns {Promise<PatientConsent>}
 */
export async function grantConsent({ payload, actor, context }) {
  if (!payload?.patientRef || !payload?.clinicId) {
    throw new Error("grantConsent: patientRef and clinicId are required");
  }
  if (!actor?.userId) {
    throw new Error("grantConsent: actor.userId is required");
  }

  // signedAt по умолчанию — сейчас (контроллер может передать другую дату
  // для бумажной/asan_imza подписи которая произошла раньше).
  const now = new Date();
  const consent = new PatientConsent({
    ...payload,
    signedAt: payload.signedAt || now,
    ipAddress: payload.ipAddress || context?.ipAddress || null,
    userAgent: payload.userAgent || context?.userAgent || null,
  });

  await consent.save();

  safeAudit({
    actor,
    action: "patient.consent.grant",
    resourceType: RESOURCE_TYPE,
    resourceId: String(consent._id),
    resourceOwnerId: payload.patientUserId
      ? String(payload.patientUserId)
      : null,
    outcome: "success",
    metadata: {
      patientTypeModel: consent.patientTypeModel,
      patientRef: String(consent.patientRef),
      clinicId: String(consent.clinicId),
      purpose: consent.purpose,
      signatureMethod: consent.signatureMethod,
      scopes: consent.scopes?.toObject?.() || consent.scopes,
      hasExpiresAt: !!consent.expiresAt,
      hasSignedDocument: !!consent.signedDocumentUrl,
    },
    context,
  });

  return consent;
}

/* ═══════════════════════════════════════════════════════════════════════════
   REVOKE — пациент отзывает consent
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Отозвать существующий consent. Идемпотентно — если уже отозван, не падает.
 *
 * @returns {Promise<PatientConsent>} — обновлённый документ
 */
export async function revokeConsent({ consentId, reason, actor, context }) {
  if (!consentId) throw new Error("revokeConsent: consentId is required");
  if (!actor?.userId) {
    throw new Error("revokeConsent: actor.userId is required");
  }

  const consent = await PatientConsent.findById(consentId);
  if (!consent) {
    safeAudit({
      actor,
      action: "patient.consent.revoke",
      resourceType: RESOURCE_TYPE,
      resourceId: String(consentId),
      outcome: "failure",
      failureReason: "consent not found",
      context,
    });
    const err = new Error("Consent not found");
    err.code = "NOT_FOUND";
    throw err;
  }

  // Идемпотентность: если уже отозван — просто возвращаем
  if (consent.revokedAt) {
    safeAudit({
      actor,
      action: "patient.consent.revoke",
      resourceType: RESOURCE_TYPE,
      resourceId: String(consent._id),
      resourceOwnerId: consent.patientUserId
        ? String(consent.patientUserId)
        : null,
      outcome: "success",
      metadata: { alreadyRevoked: true },
      context,
    });
    return consent;
  }

  consent.revokedAt = new Date();
  consent.revokedReason = reason || null;
  consent.revokedBy = actor.userId;
  await consent.save();

  safeAudit({
    actor,
    action: "patient.consent.revoke",
    resourceType: RESOURCE_TYPE,
    resourceId: String(consent._id),
    resourceOwnerId: consent.patientUserId
      ? String(consent.patientUserId)
      : null,
    outcome: "success",
    metadata: {
      clinicId: String(consent.clinicId),
      purpose: consent.purpose,
      hadReason: !!reason,
    },
    context,
  });

  return consent;
}

/* ═══════════════════════════════════════════════════════════════════════════
   UPDATE SCOPES — изменить набор разрешённых типов данных
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Изменить scopes у активного consent. Нельзя обновлять отозванный/истёкший.
 *
 * @param {object} args
 * @param {ObjectId} args.consentId
 * @param {object} args.scopes — {encounters, allergies, ...}
 */
export async function updateScopes({ consentId, scopes, actor, context }) {
  if (!consentId) throw new Error("updateScopes: consentId is required");
  if (!scopes || typeof scopes !== "object") {
    throw new Error("updateScopes: scopes object is required");
  }
  if (!actor?.userId) {
    throw new Error("updateScopes: actor.userId is required");
  }

  const consent = await PatientConsent.findById(consentId);
  if (!consent) {
    const err = new Error("Consent not found");
    err.code = "NOT_FOUND";
    throw err;
  }

  if (!PatientConsent.isActive(consent)) {
    const err = new Error(
      "Cannot update scopes on revoked or expired consent. Grant a new consent instead.",
    );
    err.code = "INACTIVE_CONSENT";
    throw err;
  }

  const previousScopes = consent.scopes?.toObject?.() || { ...consent.scopes };

  // Merge — не заменяем целиком, обновляем только переданные ключи
  Object.assign(consent.scopes, scopes);

  await consent.save();

  safeAudit({
    actor,
    action: "patient.consent.update_scopes",
    resourceType: RESOURCE_TYPE,
    resourceId: String(consent._id),
    resourceOwnerId: consent.patientUserId
      ? String(consent.patientUserId)
      : null,
    outcome: "success",
    metadata: {
      previousScopes,
      newScopes: consent.scopes?.toObject?.() || consent.scopes,
      clinicId: String(consent.clinicId),
    },
    context,
  });

  return consent;
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHECK SCOPE — пройдёт ли клиника к данным определённого типа
   ═══════════════════════════════════════════════════════════════════════════
   Используется из read-контроллеров clinic-medical:
     if (!await consentService.checkScope(patientRef, clinicId, "allergies", { actor, context })) {
       return res.status(403).json({ message: "No consent for allergies" });
     }
   
   Audit пишется ТОЛЬКО при denied (false). Логировать каждый успешный
   read = шум, основное действие (read encounter/allergy) уже логируется
   своим auditMiddleware.
*/

/**
 * @param {ObjectId} patientRef
 * @param {ObjectId} clinicId
 * @param {string} scope — "encounters" | "allergies" | "chronicDiseases" | ...
 * @param {object} [auditOpts] — { actor, context } для логирования denied
 * @returns {Promise<boolean>}
 */
export async function checkScope(patientRef, clinicId, scope, auditOpts = {}) {
  const allowed = await PatientConsent.checkScope(patientRef, clinicId, scope);

  if (!allowed && auditOpts.actor) {
    safeAudit({
      actor: auditOpts.actor,
      action: "patient.consent.check",
      resourceType: RESOURCE_TYPE,
      resourceId: null,
      resourceOwnerId: null,
      outcome: "denied",
      metadata: {
        patientRef: String(patientRef),
        clinicId: String(clinicId),
        scope,
        reason: "no_active_consent_or_scope_disabled",
      },
      context: auditOpts.context,
    });
  }

  return allowed;
}

/* ═══════════════════════════════════════════════════════════════════════════
   READ HELPERS — получить consent / список
   ═══════════════════════════════════════════════════════════════════════════ */

export function getActiveConsent(patientRef, clinicId) {
  return PatientConsent.findActive(patientRef, clinicId);
}

export function listByPatient(patientRef, opts) {
  return PatientConsent.listByPatient(patientRef, opts);
}

export function listByClinic(clinicId, opts) {
  return PatientConsent.listByClinic(clinicId, opts);
}

/* ═══════════════════════════════════════════════════════════════════════════
   CRON: expire stale consents
   ═══════════════════════════════════════════════════════════════════════════
   Этот метод вызывается из cron-задачи (раз в день) для тех consent'ов,
   у которых expiresAt < now, но revokedAt = null.
   
   Технически не обязательно "помечать" истёкшие consent'ы — findActive()
   уже отфильтровывает их по expiresAt. Но если хочется явно записать
   audit log "consent expired" — этот метод делает это.
*/
export async function expireStaleConsents({ actor }) {
  const now = new Date();
  const stale = await PatientConsent.find({
    revokedAt: null,
    expiresAt: { $lte: now },
  })
    .limit(500)
    .exec();

  for (const consent of stale) {
    safeAudit({
      actor: actor || { userId: "system", email: "cron", role: "system" },
      action: "patient.consent.expire",
      resourceType: RESOURCE_TYPE,
      resourceId: String(consent._id),
      resourceOwnerId: consent.patientUserId
        ? String(consent.patientUserId)
        : null,
      outcome: "success",
      metadata: {
        clinicId: String(consent.clinicId),
        purpose: consent.purpose,
        expiresAt: consent.expiresAt,
      },
    });
  }

  return stale.length;
}

/* ═══════════════════════════════════════════════════════════════════════════
   DEFAULT EXPORT — собранный сервис
   ═══════════════════════════════════════════════════════════════════════════ */

export default {
  grantConsent,
  revokeConsent,
  updateScopes,
  checkScope,
  getActiveConsent,
  listByPatient,
  listByClinic,
  expireStaleConsents,
};
