// modules/clinic/clinic-consent/services/consentRequest.service.js
//
// Service-обёртка для операций с ConsentRequest (Sprint 3.2 Pull Consent).
//
// Каждая операция:
//   • Валидирует входные данные
//   • Атомарно меняет FSM статус (findOneAndUpdate с status filter — idempotency)
//   • Пишет HIPAA audit log (safeAudit — fire-and-forget)
//   • Создаёт notification + email при необходимости
//
// ─────────────────────────────────────────────────────────────────────────────
//  ИСПОЛЬЗОВАНИЕ ИЗ КОНТРОЛЛЕРОВ
// ─────────────────────────────────────────────────────────────────────────────
//
//   // CLINIC — создаёт запрос
//   const request = await consentRequestService.createRequest({
//     payload: { patientRef, patientTypeModel, patientUserId, clinicId,
//                requestedScopes, message, requestedBy },
//     actor, context,
//   });
//
//   // PATIENT — одобряет
//   const { request, consent } = await consentRequestService.approveRequest({
//     requestId,
//     approvedScopes,  // optional — подмножество requestedScopes
//     actor: { userId: patientUserId, ... },
//     context,
//   });
//
//   // PATIENT — отклоняет
//   const request = await consentRequestService.rejectRequest({
//     requestId, note, actor, context,
//   });
//
//   // CLINIC — отменяет pending
//   const request = await consentRequestService.cancelRequest({
//     requestId, actor, context,
//   });
//
//   // CRON — истечение
//   const expiredCount = await consentRequestService.expireStaleRequests();
//
// ─────────────────────────────────────────────────────────────────────────────
//  ПРАВИЛА
// ─────────────────────────────────────────────────────────────────────────────
//
// • Approve/reject/cancel/expire идемпотентны через findOneAndUpdate с
//   фильтром { status: "pending" }. Двойной клик не создаст 2 PatientConsent.
//
// • При approve service создаёт PatientConsent через consent.service.grantConsent
//   с теми же conventions Sprint 3.1 (purpose=treatment, signatureMethod=electronic).
//   Если grantConsent падает — ConsentRequest НЕ переводится в approved.
//
// • Audit log — fire-and-forget. Основная операция не блокируется.
//
// • Email через ENABLE_EMAIL_NOTIFICATIONS=true feature flag (.env).
//
// ─────────────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";
import ConsentRequest, {
  CONSENT_REQUEST_MAX_ACTIVE_PENDING,
  CONSENT_REQUEST_DEFAULT_TTL_DAYS,
} from "../../../../common/models/Polyclinic/ConsentRequest.js";
import Notification from "../../../../common/models/Notification/notification.js";
import User from "../../../../common/models/Auth/users.js";
import Clinic from "../../../clinic/clinic-core/models/clinic.model.js";
import auditService from "../../../audit/services/audit.service.js";
import consentService from "./consent.service.js";
import { sendEmail } from "../../../../common/services/emailService.js";

const RESOURCE_TYPE = "consent-request";

const SCOPE_KEYS = [
  "encounters",
  "allergies",
  "chronicDiseases",
  "operations",
  "familyHistory",
  "immunization",
  "imaging",
];

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

function safeAudit(payload) {
  try {
    auditService.recordActionAsync(payload);
  } catch (err) {
    console.warn("[consentRequest.service] audit failed:", err.message);
  }
}

/**
 * Маска имени для email (HIPAA-safe).
 * "Иван Иванов" → "И. И."
 * "ismayil@example.com" → "i***@example.com"
 */
function maskName(fullName) {
  if (!fullName || typeof fullName !== "string") return "Пользователь";
  const parts = fullName.trim().split(/\s+/);
  return parts.map((p) => (p[0] || "").toUpperCase() + ".").join(" ");
}

function maskEmail(email) {
  if (!email || typeof email !== "string") return "***";
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local[0]}***@${domain}`;
}

/**
 * Email пациенту о новом запросе. Без PHI.
 * Fire-and-forget — не блокирует основной flow.
 */
async function sendNewRequestEmail({ patientEmail, clinicName }) {
  if (process.env.ENABLE_EMAIL_NOTIFICATIONS !== "true") return;
  if (!patientEmail) return;

  const subject = "DocPats: новый запрос на доступ к медкарте";
  const message = `Клиника "${clinicName}" запросила доступ к вашей медицинской карте в DocPats. Войдите в свой кабинет, чтобы рассмотреть запрос.`;

  try {
    await sendEmail(patientEmail, subject, message);
  } catch (err) {
    console.warn("[consentRequest.service] email failed:", err.message);
  }
}

/**
 * In-app notification пациенту.
 * Type: "consent_request_new" (добавлен в enum модели Notification).
 */
async function createPatientNotification({
  patientUserId,
  clinicId,
  clinicName,
  requestId,
}) {
  try {
    await Notification.create({
      userId: patientUserId,
      senderId: null,
      link: `/patient/consent-requests`,
      type: "consent_request_new",
      title: "Запрос на доступ к медкарте",
      message: `Клиника "${clinicName}" запросила доступ к вашей медицинской карте.`,
      meta: {
        clinicId: String(clinicId),
        requestId: String(requestId),
      },
      priority: "high",
      icon: "shield-check",
    });
  } catch (err) {
    // Notification create может упасть на duplicate index (sparse unique)
    // если пациент уже получал такое же уведомление — это нормально.
    console.warn("[consentRequest.service] notification failed:", err.message);
  }
}

/**
 * Возвращает чистый scopes-объект только с разрешёнными ключами.
 */
function sanitizeScopes(scopes) {
  if (!scopes || typeof scopes !== "object") return {};
  const out = {};
  for (const key of SCOPE_KEYS) {
    if (typeof scopes[key] === "boolean") {
      out[key] = scopes[key];
    }
  }
  return out;
}

/**
 * approvedScopes ⊆ requestedScopes.
 * Возвращает true если каждый approved=true есть в requested=true.
 */
function isSubsetOfRequested(approved, requested) {
  for (const key of SCOPE_KEYS) {
    if (approved[key] === true && requested[key] !== true) return false;
  }
  return true;
}

/* ═══════════════════════════════════════════════════════════════════════════
   CREATE — клиника создаёт запрос
   ═══════════════════════════════════════════════════════════════════════════ */

export async function createRequest({ payload, actor, context }) {
  if (!payload) throw new Error("createRequest: payload is required");
  if (!actor?.userId) {
    throw new Error("createRequest: actor.userId is required");
  }

  const {
    patientRef,
    patientTypeModel,
    patientUserId,
    clinicId,
    requestedScopes,
    requestedBy,
    message,
    expiresAt,
  } = payload;

  if (!patientRef || !patientTypeModel || !patientUserId || !clinicId) {
    throw new Error(
      "createRequest: patientRef, patientTypeModel, patientUserId, clinicId required",
    );
  }
  if (!requestedBy?.userId) {
    throw new Error("createRequest: requestedBy.userId is required");
  }

  const cleanScopes = sanitizeScopes(requestedScopes);
  if (!Object.values(cleanScopes).some(Boolean)) {
    const err = new Error("At least one requested scope must be true.");
    err.code = "NO_SCOPES";
    throw err;
  }

  // ─── Rate limit: max 3 pending от одной (clinic, patient) ───
  const activeCount = await ConsentRequest.countActivePending(
    patientRef,
    clinicId,
  );
  if (activeCount >= CONSENT_REQUEST_MAX_ACTIVE_PENDING) {
    safeAudit({
      actor,
      action: "consent_request.create",
      resourceType: RESOURCE_TYPE,
      resourceId: null,
      outcome: "failure",
      failureReason: "rate_limit_exceeded",
      metadata: {
        patientRef: String(patientRef),
        clinicId: String(clinicId),
        activeCount,
        limit: CONSENT_REQUEST_MAX_ACTIVE_PENDING,
      },
      context,
    });
    const err = new Error(
      `Too many active pending requests for this patient (max ${CONSENT_REQUEST_MAX_ACTIVE_PENDING}).`,
    );
    err.code = "RATE_LIMIT_EXCEEDED";
    throw err;
  }

  // ─── Create ───
  const request = new ConsentRequest({
    patientRef,
    patientTypeModel,
    patientUserId,
    clinicId,
    purpose: "treatment", // MVP hardcode
    requestedScopes: cleanScopes,
    requestedBy: {
      userId: requestedBy.userId,
      employeeId: requestedBy.employeeId || null,
    },
    message: message ? String(message).slice(0, 500) : null,
    expiresAt:
      expiresAt ||
      new Date(
        Date.now() + CONSENT_REQUEST_DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000,
      ),
    status: "pending",
    requestedAt: new Date(),
  });

  await request.save();

  safeAudit({
    actor,
    action: "consent_request.create",
    resourceType: RESOURCE_TYPE,
    resourceId: String(request._id),
    resourceOwnerId: String(patientUserId),
    outcome: "success",
    metadata: {
      patientTypeModel,
      patientRef: String(patientRef),
      clinicId: String(clinicId),
      requestedScopes: cleanScopes,
      hasMessage: !!message,
      expiresAt: request.expiresAt,
    },
    context,
  });

  // ─── Notification + email (fire-and-forget) ───
  // Не await — не блокируем response клинике.
  (async () => {
    try {
      const [clinic, patientUser] = await Promise.all([
        Clinic.findById(clinicId).select("name slug").lean(),
        User.findById(patientUserId).select("email").lean(),
      ]);
      const clinicName = clinic?.name || "Клиника";

      await Promise.allSettled([
        createPatientNotification({
          patientUserId,
          clinicId,
          clinicName,
          requestId: request._id,
        }),
        sendNewRequestEmail({
          patientEmail: patientUser?.email || null,
          clinicName,
        }),
      ]);
    } catch (err) {
      console.warn(
        "[consentRequest.service] post-create side effects failed:",
        err.message,
      );
    }
  })();

  return request;
}

/* ═══════════════════════════════════════════════════════════════════════════
   APPROVE — пациент одобряет запрос → создаёт PatientConsent
   ═══════════════════════════════════════════════════════════════════════════ */

export async function approveRequest({
  requestId,
  approvedScopes, // optional — если не передан, approve = requestedScopes
  actor,
  context,
}) {
  if (!requestId) throw new Error("approveRequest: requestId is required");
  if (!actor?.userId) {
    throw new Error("approveRequest: actor.userId is required");
  }

  // ─── Idempotency lock: atomically move pending → approved ───
  // Если кто-то параллельно уже approve'нул — second call увидит null.
  const request = await ConsentRequest.findOneAndUpdate(
    { _id: requestId, status: "pending" },
    {
      $set: {
        status: "approved",
        respondedAt: new Date(),
      },
    },
    { new: true },
  );

  if (!request) {
    // Может быть: not found OR уже не pending
    const existing = await ConsentRequest.findById(requestId);
    if (!existing) {
      const err = new Error("Consent request not found");
      err.code = "NOT_FOUND";
      throw err;
    }
    const err = new Error(
      `Request is in status "${existing.status}" and cannot be approved.`,
    );
    err.code = "NOT_PENDING";
    throw err;
  }

  // ─── Authorize: patient must own this request ───
  if (String(request.patientUserId) !== String(actor.userId)) {
    // Откатываем status назад
    request.status = "pending";
    request.respondedAt = null;
    await request.save();

    safeAudit({
      actor,
      action: "consent_request.approve",
      resourceType: RESOURCE_TYPE,
      resourceId: String(request._id),
      outcome: "failure",
      failureReason: "not_owner",
      context,
    });
    const err = new Error("Forbidden: not the request owner");
    err.code = "FORBIDDEN";
    throw err;
  }

  // ─── Determine approved scopes ───
  // Если patient передал approvedScopes — используем (с проверкой подмножества).
  // Иначе — approve = requestedScopes (полностью).
  const requestedClean =
    request.requestedScopes?.toObject?.() || request.requestedScopes;
  let approvedClean;

  if (approvedScopes && typeof approvedScopes === "object") {
    approvedClean = sanitizeScopes(approvedScopes);
    if (!isSubsetOfRequested(approvedClean, requestedClean)) {
      // Откатываем
      request.status = "pending";
      request.respondedAt = null;
      await request.save();

      const err = new Error(
        "approvedScopes must be subset of requestedScopes.",
      );
      err.code = "SCOPES_OUT_OF_RANGE";
      throw err;
    }
    if (!Object.values(approvedClean).some(Boolean)) {
      // Patient approved no scopes → это reject по факту
      request.status = "pending";
      request.respondedAt = null;
      await request.save();
      const err = new Error(
        "If you want zero scopes, use reject instead of approve.",
      );
      err.code = "ZERO_SCOPES_APPROVED";
      throw err;
    }
  } else {
    approvedClean = { ...requestedClean };
  }

  // ─── Create PatientConsent через Sprint 3.1 service ───
  let consent;
  try {
    consent = await consentService.grantConsent({
      payload: {
        patientRef: request.patientRef,
        patientTypeModel: request.patientTypeModel,
        patientUserId: request.patientUserId,
        clinicId: request.clinicId,
        purpose: "treatment",
        scopes: approvedClean,
        signedAt: new Date(),
        signedByPatient: actor.userId,
        signatureMethod: "electronic",
      },
      actor,
      context,
    });
  } catch (consentErr) {
    // Откат: запрос обратно в pending
    request.status = "pending";
    request.respondedAt = null;
    await request.save();

    safeAudit({
      actor,
      action: "consent_request.approve",
      resourceType: RESOURCE_TYPE,
      resourceId: String(request._id),
      outcome: "failure",
      failureReason: `consent_create_failed: ${consentErr.message}`,
      context,
    });
    throw consentErr;
  }

  // ─── Bind resultingConsentId ───
  request.approvedScopes = approvedClean;
  request.resultingConsentId = consent._id;
  await request.save();

  safeAudit({
    actor,
    action: "consent_request.approve",
    resourceType: RESOURCE_TYPE,
    resourceId: String(request._id),
    resourceOwnerId: String(request.patientUserId),
    outcome: "success",
    metadata: {
      clinicId: String(request.clinicId),
      requestedScopes: requestedClean,
      approvedScopes: approvedClean,
      resultingConsentId: String(consent._id),
      partialApproval: !isAllTrue(approvedClean, requestedClean),
    },
    context,
  });

  return { request, consent };
}

function isAllTrue(approved, requested) {
  // True если approved === requested (для metadata "partialApproval" flag)
  for (const key of SCOPE_KEYS) {
    if ((requested[key] === true) !== (approved[key] === true)) return false;
  }
  return true;
}

/* ═══════════════════════════════════════════════════════════════════════════
   REJECT — пациент отклоняет запрос
   ═══════════════════════════════════════════════════════════════════════════ */

export async function rejectRequest({ requestId, note, actor, context }) {
  if (!requestId) throw new Error("rejectRequest: requestId is required");
  if (!actor?.userId) {
    throw new Error("rejectRequest: actor.userId is required");
  }

  const request = await ConsentRequest.findOneAndUpdate(
    { _id: requestId, status: "pending" },
    {
      $set: {
        status: "rejected",
        respondedAt: new Date(),
        respondedNote: note ? String(note).slice(0, 500) : null,
      },
    },
    { new: true },
  );

  if (!request) {
    const existing = await ConsentRequest.findById(requestId);
    if (!existing) {
      const err = new Error("Consent request not found");
      err.code = "NOT_FOUND";
      throw err;
    }
    const err = new Error(
      `Request is in status "${existing.status}" and cannot be rejected.`,
    );
    err.code = "NOT_PENDING";
    throw err;
  }

  if (String(request.patientUserId) !== String(actor.userId)) {
    request.status = "pending";
    request.respondedAt = null;
    request.respondedNote = null;
    await request.save();

    safeAudit({
      actor,
      action: "consent_request.reject",
      resourceType: RESOURCE_TYPE,
      resourceId: String(request._id),
      outcome: "failure",
      failureReason: "not_owner",
      context,
    });
    const err = new Error("Forbidden: not the request owner");
    err.code = "FORBIDDEN";
    throw err;
  }

  safeAudit({
    actor,
    action: "consent_request.reject",
    resourceType: RESOURCE_TYPE,
    resourceId: String(request._id),
    resourceOwnerId: String(request.patientUserId),
    outcome: "success",
    metadata: {
      clinicId: String(request.clinicId),
      hadNote: !!note,
    },
    context,
  });

  return request;
}

/* ═══════════════════════════════════════════════════════════════════════════
   CANCEL — клиника отменяет свой pending запрос
   ═══════════════════════════════════════════════════════════════════════════ */

export async function cancelRequest({ requestId, actor, context }) {
  if (!requestId) throw new Error("cancelRequest: requestId is required");
  if (!actor?.userId) {
    throw new Error("cancelRequest: actor.userId is required");
  }

  const request = await ConsentRequest.findOneAndUpdate(
    { _id: requestId, status: "pending" },
    {
      $set: {
        status: "cancelled",
        respondedAt: new Date(),
      },
    },
    { new: true },
  );

  if (!request) {
    const existing = await ConsentRequest.findById(requestId);
    if (!existing) {
      const err = new Error("Consent request not found");
      err.code = "NOT_FOUND";
      throw err;
    }
    const err = new Error(
      `Request is in status "${existing.status}" and cannot be cancelled.`,
    );
    err.code = "NOT_PENDING";
    throw err;
  }

  safeAudit({
    actor,
    action: "consent_request.cancel",
    resourceType: RESOURCE_TYPE,
    resourceId: String(request._id),
    resourceOwnerId: String(request.patientUserId),
    outcome: "success",
    metadata: {
      clinicId: String(request.clinicId),
    },
    context,
  });

  return request;
}

/* ═══════════════════════════════════════════════════════════════════════════
   EXPIRE STALE — CRON: pending + expiresAt<now → expired
   ═══════════════════════════════════════════════════════════════════════════ */

export async function expireStaleRequests() {
  const now = new Date();
  const result = await ConsentRequest.updateMany(
    {
      status: "pending",
      expiresAt: { $lte: now },
    },
    {
      $set: {
        status: "expired",
        respondedAt: now,
      },
    },
  );

  if (result.modifiedCount > 0) {
    safeAudit({
      actor: { userId: "system", email: "cron", role: "system" },
      action: "consent_request.expire_batch",
      resourceType: RESOURCE_TYPE,
      resourceId: null,
      outcome: "success",
      metadata: {
        expiredCount: result.modifiedCount,
        runAt: now,
      },
    });
  }

  return result.modifiedCount;
}

/* ═══════════════════════════════════════════════════════════════════════════
   READ HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Все pending запросы для пациента (для UI кабинета).
 */
export function listPendingForPatient(patientUserId, opts) {
  return ConsentRequest.listPendingForPatient(patientUserId, opts);
}

/**
 * История запросов клиники на конкретного пациента.
 */
export function listByClinicAndPatient(clinicId, patientRef, opts) {
  return ConsentRequest.listByClinicAndPatient(clinicId, patientRef, opts);
}

/**
 * Один запрос по id (с защитой по patientUserId или clinicId — на контроллере).
 */
export function findById(requestId) {
  return ConsentRequest.findById(requestId).exec();
}

/* ═══════════════════════════════════════════════════════════════════════════
   DEFAULT EXPORT
   ═══════════════════════════════════════════════════════════════════════════ */

export default {
  createRequest,
  approveRequest,
  rejectRequest,
  cancelRequest,
  expireStaleRequests,
  listPendingForPatient,
  listByClinicAndPatient,
  findById,
};
