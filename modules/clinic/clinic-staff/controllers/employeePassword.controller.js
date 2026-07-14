// modules/clinic/clinic-staff/controllers/employeePassword.controller.js
//
// HTTP-обработчики для работы с паролем сотрудника клиники.
//
// Публичные:      forgotPassword, resetContext, resetPassword
// С авторизацией: changePassword (по req.session.employeeId)
//
// Эти маршруты подключаются ДО tenantMiddleware (см. modules/clinic/index.js),
// то есть tenant-контекста здесь нет — и он не нужен: сотрудник это глобальная
// личность, его пароль не привязан к конкретной клинике.

import * as passwordService from "../services/employeePassword.service.js";
import {
  forgotPasswordSchema,
  resetContextSchema,
  resetPasswordSchema,
  changePasswordSchema,
} from "../validators/employeePassword.schemas.js";
import {
  ValidationError,
  UnauthorizedError,
} from "../../../../common/utils/errors.js";

function parseOrThrow(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError("Invalid input", { issues: result.error.issues });
  }
  return result.data;
}

/** Контекст запроса для аудита — никаких ПДн, только откуда пришёл запрос. */
function requestContext(req) {
  return {
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    sessionId: req.sessionID,
  };
}

// ─── POST /employees/forgot-password ──────────────────────────
//
// ВСЕГДА отвечает 200 с одним и тем же телом — независимо от того, есть такой
// сотрудник или нет. Иначе эндпоинт становится способом проверять, работает ли
// человек в клинике. Сервис для таких случаев ошибку не бросает.

export async function forgotPassword(req, res, next) {
  try {
    const data = parseOrThrow(forgotPasswordSchema, req.body);

    await passwordService.requestPasswordReset({
      email: data.email,
      context: requestContext(req),
    });

    res.json({
      success: true,
      message:
        "If that email belongs to a staff account, a reset link is on its way.",
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /employees/reset-password?token=… ────────────────────
//
// Позволяет странице сброса ещё до ввода кода отличить живую ссылку от
// протухшей. Возвращает только ЗАМАСКИРОВАННЫЙ email.

export async function resetContext(req, res, next) {
  try {
    const data = parseOrThrow(resetContextSchema, { token: req.query?.token });

    const context = await passwordService.getResetContext({
      token: data.token,
    });

    res.json({ valid: true, ...context });
  } catch (err) {
    next(err);
  }
}

// ─── POST /employees/reset-password ───────────────────────────

export async function resetPassword(req, res, next) {
  try {
    const data = parseOrThrow(resetPasswordSchema, req.body);

    await passwordService.resetPassword({
      token: data.token,
      otp: data.otp,
      password: data.password,
      context: requestContext(req),
    });

    res.json({
      success: true,
      message: "Password updated. You can now sign in.",
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /employees/change-password ──────────────────────────

export async function changePassword(req, res, next) {
  try {
    const employeeId = req.session?.employeeId;
    if (!employeeId) {
      throw new UnauthorizedError("Not authenticated");
    }

    const data = parseOrThrow(changePasswordSchema, req.body);

    await passwordService.changePassword({
      employeeId,
      currentPassword: data.currentPassword,
      newPassword: data.newPassword,
      context: requestContext(req),
    });

    res.json({ success: true, message: "Password updated." });
  } catch (err) {
    next(err);
  }
}
