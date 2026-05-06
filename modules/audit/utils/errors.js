// modules/audit/utils/errors.js
//
// Кастомные ошибки для audit-модуля.
//
// Использование:
//   import { ForbiddenError } from "../utils/errors.js";
//   if (!isAdmin) throw new ForbiddenError("audit history", "admin role required");

/* ============================================================
   ForbiddenError — 403 Forbidden
   ============================================================
   Используется когда юзер аутентифицирован, но не имеет прав
   на конкретный ресурс / действие.
   ============================================================ */

export class ForbiddenError extends Error {
  constructor(resource, reason) {
    super(
      `Forbidden: cannot access ${resource}${reason ? ` — ${reason}` : ""}`,
    );
    this.name = "ForbiddenError";
    this.status = 403;
    this.code = "FORBIDDEN";
    this.resource = resource;
    this.reason = reason;
  }
}

/* ============================================================
   ValidationError — 400 Bad Request
   ============================================================ */

export class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = "ValidationError";
    this.status = 400;
    this.code = "VALIDATION_ERROR";
    this.field = field;
  }
}

/* ============================================================
   NotFoundError — 404
   ============================================================ */

export class NotFoundError extends Error {
  constructor(resource, id) {
    super(`${resource} not found${id ? `: ${id}` : ""}`);
    this.name = "NotFoundError";
    this.status = 404;
    this.code = "NOT_FOUND";
  }
}

export default {
  ForbiddenError,
  ValidationError,
  NotFoundError,
};
