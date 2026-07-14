// modules/clinic/clinic-staff/routes/employeeAuth.routes.js
//
// Routes for ClinicEmployee authentication (Global Clinic Worker model).
//
// All endpoints live under /api/v1/clinic/employees/* (mounted in modules/clinic/index.js).
//
// POST /login             — public: email + password → session (+ auto-select
//                           clinic when the worker belongs to exactly one; else
//                           returns needsClinicSelection + list of clinics)
// POST /select-clinic     — authenticated: pick which clinic to work in
//                           (multi-clinic workers) → sets session.clinicId
// POST /logout            — clears the employee identity from the session
// GET  /me                — current worker + selected clinic context
//
// Работа с паролем (см. employeePassword.controller.js):
// POST /forgot-password   — публичный: письмо со ссылкой и кодом (всегда 200)
// GET  /reset-password    — публичный: проверить ссылку перед показом формы
// POST /reset-password    — публичный: ссылка + код + новый пароль
// POST /change-password   — с авторизацией: текущий пароль + новый

import express from "express";
import * as authController from "../controllers/employeeAuth.controller.js";
import * as passwordController from "../controllers/employeePassword.controller.js";
import {
  loginLimiter,
  passwordResetLimiter,
} from "../../../../common/middlewares/rateLimiter.js";

const router = express.Router();

router.post("/employees/login", loginLimiter, authController.login);
router.post("/employees/select-clinic", authController.selectClinic);
router.post("/employees/logout", authController.logout);
router.get("/employees/me", authController.me);

// Восстановление пароля вынужденно публичное — сотрудник ведь не может войти,
// в этом и смысл. Поэтому на оба маршрута повешен ограничитель частоты.
router.post(
  "/employees/forgot-password",
  passwordResetLimiter,
  passwordController.forgotPassword,
);
router.get(
  "/employees/reset-password",
  passwordResetLimiter,
  passwordController.resetContext,
);
router.post(
  "/employees/reset-password",
  passwordResetLimiter,
  passwordController.resetPassword,
);
router.post("/employees/change-password", passwordController.changePassword);

export default router;
