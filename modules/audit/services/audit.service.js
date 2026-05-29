// modules/audit/services/audit.service.js
//
// Сервисный слой для HIPAA Audit Log.
//
// Основные точки входа:
//   - recordAction      — синхронная запись (внутри транзакций, для критичных
//                         событий). Кидает ошибку если БД упала.
//   - recordActionAsync — fire-and-forget. НЕ кидает ошибку, просто warning.
//                         Для read/view событий, чтобы не блокировать UX.
//   - recordDeniedAccess — шорткат для outcome="denied".
//
// Все query-методы возвращают mongoose-документы.
//
// ⚠️ Если запись в audit log падает на критичном событии (create PHI),
//    операция должна быть откачена. Используй внутри транзакции с session.

import HIPAAAuditLog from "../models/AuditLog.model.js";

/* ═══════════ recordAction — синхронная запись ═══════════ */

/**
 * Записать событие в audit log.
 *
 * @param {object} params
 * @param {object} params.actor          — { userId, email, role } (required)
 * @param {string} params.action         — из ACTION_ENUM (required)
 * @param {string} params.resourceType   — из RESOURCE_TYPE_ENUM (required)
 * @param {string} params.resourceId     — ObjectId конкретного ресурса (required)
 * @param {string} [params.caseId]       — anthropometry case id (если применимо)
 * @param {string} [params.resourceOwnerId] — userId владельца ресурса
 * @param {string} [params.outcome="success"] — success/failure/denied
 * @param {string} [params.failureReason] — текст ошибки если outcome != success
 * @param {object} [params.metadata]     — произвольные данные БЕЗ PHI
 * @param {object} [params.context]      — { ipAddress, userAgent, sessionId, requestId,
 *                                           httpMethod, httpPath, statusCode }
 * @param {object} [params.session]      — mongoose session для транзакций
 * @param {string} [params.impersonatedBy] — если действие от имени другого юзера
 *
 * @returns {Promise<HIPAAAuditLog>} Созданный документ
 * @throws {Error} Если обязательные поля отсутствуют или БД недоступна
 */
export const recordAction = async (params) => {
  const {
    actor,
    action,
    resourceType,
    resourceId,
    caseId,
    resourceOwnerId,
    outcome = "success",
    failureReason,
    metadata,
    context = {},
    session,
    impersonatedBy,
  } = params;

  // Валидация обязательных полей.
  // Кидаем ошибку — не молчим. Если audit log не пишется,
  // это серьёзная проблема compliance, её нужно увидеть.
  if (!actor || !actor.userId) {
    throw new Error("audit.recordAction: actor.userId is required");
  }
  if (!action) {
    throw new Error("audit.recordAction: action is required");
  }
  if (!resourceType) {
    throw new Error("audit.recordAction: resourceType is required");
  }
  // resourceId опционален для list-actions (например, "list dialogs")
  // Но для всех остальных действий — должен быть.
  // resourceId опционален для коллекционных действий — list И search.
  // У "list dialogs" / "search patients" / "search users" нет одного
  // конкретного resourceId: они работают над выборкой, а не над записью.
  // Для всех остальных действий resourceId обязателен.
  const isCollectionAction =
    action === "list" ||
    action.endsWith(".list") ||
    action.endsWith(".search") ||
    action.endsWith(".user_search") ||
    action === "system.r2_orphan.cleanup";
  if (!resourceId && !isCollectionAction) {
    throw new Error(
      `audit.recordAction: resourceId is required for action "${action}"`,
    );
  }
  const doc = {
    userId: actor.userId,
    impersonatedBy: impersonatedBy || null,
    actorEmail: actor.email || null,
    actorRole: actor.role || null,

    action,
    resourceType,
    resourceId: resourceId || null,
    caseId: caseId || null,
    resourceOwnerId: resourceOwnerId || null,

    outcome,
    failureReason: failureReason || null,

    httpMethod: context.httpMethod || null,
    httpPath: context.httpPath ? String(context.httpPath).slice(0, 500) : null,
    statusCode: context.statusCode || null,

    ipAddress: context.ipAddress || null,
    userAgent: context.userAgent
      ? String(context.userAgent).slice(0, 500)
      : null,
    sessionId: context.sessionId || null,
    requestId: context.requestId || null,

    metadata: metadata || null,
  };

  // Mongoose create() с session требует массив + опции
  const opts = session ? { session } : undefined;
  const created = session
    ? await HIPAAAuditLog.create([doc], opts)
    : await HIPAAAuditLog.create(doc);

  return Array.isArray(created) ? created[0] : created;
};

/* ═══════════ recordActionAsync — fire-and-forget ═══════════ */

/**
 * Fire-and-forget обёртка над recordAction.
 *
 * Использовать когда не хотим блокировать основную операцию ради записи лога.
 * Например — после успешного просмотра фото пишем 'photo.view', но если запись
 * лога падает — пользователь всё равно должен увидеть фото.
 *
 * ⚠️ Ошибки логируются в console, но НЕ пробрасываются.
 *
 * Использовать только для НЕкритических audit events (просмотры, обращения к API).
 * Для критических event (create/update/delete PHI) использовать обычный
 * recordAction внутри транзакции.
 */
export const recordActionAsync = (params) => {
  recordAction(params).catch((err) => {
    console.warn("[audit] async recordAction failed:", err.message, "params:", {
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId?.toString?.() || params.resourceId,
    });
  });
};

/* ═══════════ recordDeniedAccess — шорткат ═══════════ */

/**
 * Зафиксировать отказ доступа (outcome="denied").
 *
 * Используется в middleware проверки прав или при отказах в контроллерах.
 * Эти записи особенно важны для детекции скомпрометированных аккаунтов:
 * множество denied от одного юзера → подозрительная активность.
 */
export const recordDeniedAccess = (params) => {
  return recordAction({
    ...params,
    outcome: "denied",
  });
};

/* ═══════════ QUERY METHODS ═══════════
   Чтение audit log для админ-панели и compliance-отчётов.
   В сервисном слое — потому что чтение PHI-related данных
   тоже требует логирования (мета-аудит). */

/**
 * История действий пользователя за период.
 */
export const getUserActivity = async (userId, options = {}) => {
  return HIPAAAuditLog.findByUser(userId, options);
};

/**
 * История действий по случаю (anthropometry).
 */
export const getCaseHistory = async (caseId, options = {}) => {
  return HIPAAAuditLog.findByCase(caseId, options);
};

/**
 * Все действия с конкретным ресурсом.
 */
export const getResourceHistory = async (
  resourceType,
  resourceId,
  options = {},
) => {
  return HIPAAAuditLog.findByResource(resourceType, resourceId, options);
};

/**
 * Кто работал с PHI конкретного пользователя/пациента.
 * (Право пациента по HIPAA: "покажите кто видел мои данные")
 */
export const getOwnerHistory = async (ownerId, options = {}) => {
  return HIPAAAuditLog.findByOwner(ownerId, options);
};

/**
 * Подозрительная активность — отказы доступа за период.
 * Используется для security monitoring.
 */
export const getDeniedAttempts = async (options = {}) => {
  return HIPAAAuditLog.findDeniedAttempts(options);
};

/**
 * Кто смотрел конкретный ресурс.
 */
export const getResourceViewers = async (
  resourceType,
  resourceId,
  options = {},
) => {
  return HIPAAAuditLog.findResourceViews(resourceType, resourceId, options);
};

/* ═══════════ DEFAULT EXPORT ═══════════ */

export default {
  recordAction,
  recordActionAsync,
  recordDeniedAccess,
  getUserActivity,
  getCaseHistory,
  getResourceHistory,
  getOwnerHistory,
  getDeniedAttempts,
  getResourceViewers,
};
