// modules/clinic/clinic-staff/validators/employeePassword.schemas.js
//
// Zod-схемы для работы с паролем сотрудника клиники.
//
// Требование к паролю ДОЛЖНО совпадать с invitation.schemas.js — именно там
// сотрудник задаёт пароль в первый раз. Если здесь сделать строже, человек не
// сможет восстановить пароль, который ему разрешили придумать при регистрации.

import { z } from "zod";

const passwordField = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(200, "Password too long");

const otpField = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Code must be 6 digits");

const tokenField = z.string().trim().min(1, "Token is required");

// Шаг 1 — «забыл пароль»: только email.
export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email("Invalid email format"),
  // Язык письма = язык, выбранный на странице сейчас. Необязателен: если не
  // передан или неизвестен, сервис возьмёт язык из профиля сотрудника.
  language: z.string().trim().optional(),
});

// Шаг 2 — открытие страницы по ссылке из письма.
export const resetContextSchema = z.object({
  token: tokenField,
});

// Шаг 3 — установка нового пароля: ссылка + код + пароль.
export const resetPasswordSchema = z.object({
  token: tokenField,
  otp: otpField,
  password: passwordField,
});

// Смена пароля в кабинете (сотрудник уже вошёл).
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required").max(200),
  newPassword: passwordField,
});
