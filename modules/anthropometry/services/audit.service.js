// server/modules/anthropometry/services/audit.service.js

import AuditLog from "../models/AuditLog.model.js";

/* ============================================================
   AUDIT SERVICE
   ============================================================
   Запись HIPAA-совместимого audit log для всех действий
   с медицинскими данными.

   Каждое действие в модуле должно вызывать recordAction()
   ПОСЛЕ успешного завершения операции (или при отказе доступа).

   Все функции — append-only. AuditLog нельзя редактировать
   или удалять (запрещено на уровне модели).
   ============================================================ */

/* ============================================================
   recordAction — основной метод
   ============================================================
   Используется внутри транзакций и для синхронной записи.

   Параметры:
   - actor         (required) : { userId, email, role }
   - action        (required) : строка из ACTION_ENUM модели
   - resourceType  (required) : 'PatientCase' | 'Study' | 'Photo' | 'Annotation'
   - resourceId    (required) : ObjectId изменённого ресурса
   - caseId        (optional) : денормализованный caseId для быстрых выборок
   - outcome       (optional) : 'success' | 'failure' | 'denied' (default: 'success')
   - failureReason (optional) : текст ошибки если outcome != success
   - metadata      (optional) : произвольная структура с деталями
   - context       (optional) : { ipAddress, userAgent, sessionId, requestId }
   - session       (optional) : Mongoose session для транзакций

   Возвращает: созданный документ AuditLog
   ============================================================ */

export const recordAction = async (params) => {
  const {
    actor,
    action,
    resourceType,
    resourceId,
    caseId,
    outcome = "success",
    failureReason,
    metadata,
    context = {},
    session,
  } = params;

  // Валидация обязательных полей.
  // Кидаем ошибку — не молчим. Если audit log не записывается,
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
  if (!resourceId) {
    throw new Error("audit.recordAction: resourceId is required");
  }

  const doc = {
    userId: actor.userId,
    actorEmail: actor.email, // снэпшот на момент действия
    actorRole: actor.role,

    action,
    resourceType,
    resourceId,
    caseId,

    outcome,
    failureReason,
    metadata,

    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    sessionId: context.sessionId,
    requestId: context.requestId,
  };

  // Mongoose create() с session требует массив + опции
  const opts = session ? { session } : undefined;
  const created = session
    ? await AuditLog.create([doc], opts)
    : await AuditLog.create(doc);

  // create([...]) возвращает массив, create({...}) — документ
  return Array.isArray(created) ? created[0] : created;
};

/* ============================================================
   recordActionAsync — fire-and-forget обёртка
   ============================================================
   Используется когда не хотим блокировать основную операцию
   ради записи лога. Например — после успешного просмотра фото
   мы записываем 'photo.view', но если запись лога падает —
   пользователь всё равно должен увидеть фото.

   ВАЖНО: ошибки логируются, но не пробрасываются.
   Использовать только для НЕкритических audit events
   (просмотры, обращения к API).

   Для критических event (создание/изменение/удаление PHI)
   использовать обычный recordAction внутри транзакции.
   ============================================================ */

export const recordActionAsync = (params) => {
  recordAction(params).catch((err) => {
    console.error(
      "[audit] async recordAction failed:",
      err.message,
      "params:",
      {
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId?.toString(),
      },
    );
  });
};

/* ============================================================
   recordDeniedAccess — частный случай для отказов доступа
   ============================================================
   Удобный шорткат для логирования попыток несанкционированного
   доступа. Используется в middleware caseOwnership.js (Шаг 4).

   Эти записи особенно важны для детекции скомпрометированных
   аккаунтов. */

export const recordDeniedAccess = (params) => {
  return recordAction({
    ...params,
    outcome: "denied",
  });
};

/* ============================================================
   QUERY METHODS
   ============================================================
   Чтение audit log для админ-панели и compliance-отчётов.
   В сервисном слое — потому что чтение PHI-related данных
   тоже требует логирования (мета-аудит). */

/**
 * История действий по конкретному случаю.
 * Используется в админ-панели "история случая".
 */
export const getCaseHistory = async (caseId, options = {}) => {
  const { limit = 100, skip = 0, action } = options;
  return AuditLog.findByCase(caseId, { limit, skip, action });
};

/**
 * История действий пользователя за период.
 * Используется в "audit dashboard" для compliance officer.
 */
export const getUserActivity = async (userId, options = {}) => {
  return AuditLog.findByUser(userId, options);
};

/**
 * Отказы в доступе за период.
 * Используется для мониторинга безопасности.
 */
export const getDeniedAttempts = async (options = {}) => {
  return AuditLog.findDeniedAttempts(options);
};

/**
 * Кто смотрел конкретный ресурс.
 * Используется когда пациент запрашивает "кто видел мои данные"
 * (право пациента по HIPAA).
 */
export const getResourceViewers = async (
  resourceType,
  resourceId,
  options = {},
) => {
  return AuditLog.findResourceViews(resourceType, resourceId, options);
};

/* ============================================================
   DEFAULT EXPORT
   ============================================================ */

export default {
  recordAction,
  recordActionAsync,
  recordDeniedAccess,
  getCaseHistory,
  getUserActivity,
  getDeniedAttempts,
  getResourceViewers,
};
