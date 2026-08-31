// server/common/middlewares/errorHandler.js
//
// Global error handler for Express.
// Use ONLY for new clinic routes — DO NOT mount globally,
// as it would change behaviour of existing legacy routes.

import logger from "../logger.js";
import { toErrorResponse, AppError } from "../utils/errors.js";
import { tReq, translateKnown } from "../i18n/index.js";

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

  // Перевод сообщения по коду — здесь, в одном месте на все ошибки.
  //
  // Службы и модели не видят запроса, а значит не знают языка собеседника:
  // req.t им недоступен. Поэтому они бросают ошибку с кодом в details, а
  // перевод подставляется тут, где запрос уже есть.
  //
  // Текст самой ошибки остаётся запасным: код, которого нет в словаре, не
  // должен стирать сообщение — лучше показать русскую фразу, чем пустоту.
  // Код лежит либо в details (наследники AppError), либо прямо на ошибке
  // (свои классы вроде BookingPatientError). Оба варианта — один механизм.
  const i18nCode = err?.details?.i18n || err?.i18n;
  if (i18nCode) {
    body.error = tReq(req, i18nCode, err?.details?.i18nParams || {}, body.error);
  } else {
    // Кода нет — пробуем узнать саму фразу. Так переводятся сообщения,
    // которые некому было пометить кодом: их русский текст есть в словаре.
    body.error = translateKnown(body.error, req);
  }

  // Подробности разбора запроса приходят готовым деревом от схемы.
  if (body.details) body.details = translateKnown(body.details, req);

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
