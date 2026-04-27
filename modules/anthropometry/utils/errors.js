// server/modules/anthropometry/utils/errors.js

/* ============================================================
   DOMAIN-SPECIFIC ERRORS
   ============================================================
   Кастомные классы ошибок для модуля anthropometry.

   Зачем не обычный Error:
   - Контроллер может маппить их в HTTP-коды без парсинга
     текста сообщений
   - Можно отличить "пользовательскую" ошибку от системной
     (401/403/404 vs 500)
   - Структурированные данные (errorCode, details) для
     i18n на фронте

   Иерархия:
     AnthropometryError (база)
     ├── NotFoundError       → HTTP 404
     ├── ForbiddenError      → HTTP 403
     ├── ValidationError     → HTTP 400
     ├── ConflictError       → HTTP 409
     └── PreconditionError   → HTTP 412
   ============================================================ */

export class AnthropometryError extends Error {
  constructor(message, errorCode, details = null) {
    super(message);
    this.name = this.constructor.name;
    this.errorCode = errorCode;
    this.details = details;
    this.isAnthropometryError = true;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * Ресурс не найден.
 * Используется когда findById возвращает null.
 */
export class NotFoundError extends AnthropometryError {
  constructor(resource, id) {
    super(`${resource} not found: ${id}`, "RESOURCE_NOT_FOUND", {
      resource,
      id: String(id),
    });
    this.httpStatus = 404;
  }
}

/**
 * Действие запрещено для текущего пользователя.
 * Используется когда пользователь не владелец ресурса
 * или не имеет нужной роли.
 */
export class ForbiddenError extends AnthropometryError {
  constructor(action, reason = null) {
    super(`Forbidden: ${action}${reason ? ` (${reason})` : ""}`, "FORBIDDEN", {
      action,
      reason,
    });
    this.httpStatus = 403;
  }
}

/**
 * Невалидные входные данные.
 * Используется когда переданные параметры не проходят
 * бизнес-валидацию (отдельно от Mongoose schema validation).
 */
export class ValidationError extends AnthropometryError {
  constructor(message, fields = {}) {
    super(message, "VALIDATION_FAILED", { fields });
    this.httpStatus = 400;
  }
}

/**
 * Конфликт с текущим состоянием ресурса.
 * Используется когда операция невозможна из-за состояния
 * (например, попытка удалить уже удалённый случай).
 */
export class ConflictError extends AnthropometryError {
  constructor(message, currentState = null) {
    super(message, "CONFLICT", { currentState });
    this.httpStatus = 409;
  }
}

/**
 * Не выполнено предусловие для операции.
 * Используется например когда пытаются разметить фото
 * на нескалиброванном Study.
 */
export class PreconditionError extends AnthropometryError {
  constructor(message, requirement = null) {
    super(message, "PRECONDITION_FAILED", { requirement });
    this.httpStatus = 412;
  }
}
