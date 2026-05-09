// server/common/middlewares/errorHandler.js
//
// Global error handler for Express.
// Use ONLY for new clinic routes — DO NOT mount globally,
// as it would change behaviour of existing legacy routes.

import logger from "../logger.js";
import { toErrorResponse, AppError } from "../utils/errors.js";

export function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const isOperational = err instanceof AppError;
  const { status, body } = toErrorResponse(err);

  const logContext = {
    method: req.method,
    url: req.originalUrl,
    status,
    code: body.code,
    userId: req.session?.userId || null,
    clinicId: req.tenantContext?.clinicId || null,
  };

  if (isOperational) {
    logger.warn(logContext, `[handled] ${err.message}`);
  } else {
    logger.error({ ...logContext, err }, `[unhandled] ${err.message}`);
  }

  if (body.retryAfter) {
    res.setHeader("Retry-After", body.retryAfter);
  }

  res.status(status).json(body);
}

export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function notFoundHandler(req, res, next) {
  res.status(404).json({
    error: "Route not found",
    code: "NOT_FOUND",
    path: req.originalUrl,
  });
}
