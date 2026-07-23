// server/common/utils/errors.js
//
// Custom error classes for the clinic module.
// All classes extend AppError and carry HTTP status + machine-readable code.

export class AppError extends Error {
  constructor(message, status = 500, code = "INTERNAL_ERROR", details = null) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed", details = null) {
    super(message, 400, "VALIDATION_ERROR", details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden", details = null) {
    super(message, 403, "FORBIDDEN", details);
  }
}

export class TenantViolationError extends AppError {
  constructor(message = "Cross-tenant access denied") {
    super(message, 403, "TENANT_VIOLATION");
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super(`${resource} not found`, 404, "NOT_FOUND", { resource });
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict", details = null) {
    super(message, 409, "CONFLICT", details);
  }
}

export class FeatureNotEnabledError extends AppError {
  constructor(feature) {
    super(
      `Feature '${feature}' is not enabled for your clinic`,
      403,
      "FEATURE_NOT_ENABLED",
      { feature },
    );
  }
}

/**
 * Лимит тарифа исчерпан — в отличие от ForbiddenError это не «нельзя»,
 * а «нельзя сейчас, но можно после апгрейда». 402 позволяет клиенту
 * отличить исчерпанную квоту от отсутствия прав и показать апселл, а не
 * страницу ошибки. В details кладём цифры, чтобы UI не ходил за ними
 * вторым запросом.
 */
export class QuotaExceededError extends AppError {
  constructor(message = "Лимит тарифа исчерпан", details = null) {
    super(message, 402, "QUOTA_EXCEEDED", details);
  }
}

export class UnprocessableError extends AppError {
  constructor(message = "Cannot process request", details = null) {
    super(message, 422, "UNPROCESSABLE", details);
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfterSec = null) {
    super("Too many requests", 429, "RATE_LIMITED");
    this.retryAfter = retryAfterSec;
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = "Service temporarily unavailable") {
    super(message, 503, "SERVICE_UNAVAILABLE");
  }
}

export function toErrorResponse(err) {
  if (err instanceof AppError) {
    return {
      status: err.status,
      body: {
        error: err.message,
        code: err.code,
        ...(err.details && { details: err.details }),
        ...(err.retryAfter && { retryAfter: err.retryAfter }),
      },
    };
  }

  if (err.name === "ValidationError" && err.errors) {
    const details = Object.entries(err.errors).reduce((acc, [key, val]) => {
      acc[key] = val.message;
      return acc;
    }, {});
    return {
      status: 400,
      body: {
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details,
      },
    };
  }

  if (err.name === "CastError") {
    return {
      status: 400,
      body: {
        error: `Invalid ${err.path}: ${err.value}`,
        code: "VALIDATION_ERROR",
      },
    };
  }

  if (err.code === 11000) {
    return {
      status: 409,
      body: {
        error: "Duplicate key",
        code: "CONFLICT",
        details: { keyPattern: err.keyPattern, keyValue: err.keyValue },
      },
    };
  }

  return {
    status: 500,
    body: {
      error:
        process.env.NODE_ENV === "production"
          ? "Internal server error"
          : err.message,
      code: "INTERNAL_ERROR",
    },
  };
}
