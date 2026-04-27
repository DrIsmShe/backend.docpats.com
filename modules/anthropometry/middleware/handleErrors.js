import { AnthropometryError } from "../utils/errors.js";

/* ============================================================
   ERROR HANDLER MIDDLEWARE
   ============================================================
   Превращает любые ошибки в стандартный JSON response.

   Express определяет error handler по числу аргументов (4).
   Подключается В САМОМ КОНЦЕ роутов модуля.
   ============================================================ */

const isDev = process.env.NODE_ENV !== "production";

const handleErrors = (err, req, res, next) => {
  // 1. Наши кастомные ошибки модуля
  if (err.isAnthropometryError) {
    const status = err.httpStatus || 500;
    const body = {
      error: {
        code: err.errorCode,
        message: err.message,
        details: err.details,
      },
    };
    if (isDev) body.error.stack = err.stack;
    return res.status(status).json(body);
  }

  // 2. Mongoose ValidationError (нарушение схемы)
  if (err.name === "ValidationError" && err.errors) {
    const fields = {};
    for (const [path, fieldErr] of Object.entries(err.errors)) {
      fields[path] = fieldErr.message;
    }
    return res.status(400).json({
      error: {
        code: "MONGOOSE_VALIDATION_FAILED",
        message: "Schema validation failed",
        details: { fields },
      },
    });
  }

  // 3. Mongoose CastError (невалидный ObjectId)
  if (err.name === "CastError") {
    return res.status(400).json({
      error: {
        code: "INVALID_ID",
        message: `Invalid ${err.path}: ${err.value}`,
        details: { field: err.path, value: String(err.value) },
      },
    });
  }

  // 4. Mongoose duplicate key (unique index violation)
  if (err.code === 11000 || err.code === 11001) {
    return res.status(409).json({
      error: {
        code: "DUPLICATE_KEY",
        message: "Resource with this value already exists",
        details: { fields: err.keyValue },
      },
    });
  }

  // 5. Unknown errors — логируем как critical
  console.error("[anthropometry] Unhandled error:", err);

  const body = {
    error: {
      code: "INTERNAL_ERROR",
      message: isDev ? err.message : "Internal server error",
    },
  };
  if (isDev) {
    body.error.stack = err.stack;
    body.error.originalError = err.name;
  }

  res.status(500).json(body);
};

export default handleErrors;
