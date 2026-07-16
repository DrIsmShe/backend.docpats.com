// modules/clinic/clinic-staff/services/employeePassword.service.js
//
// Работа с паролем сотрудника клиники (ClinicEmployee):
// восстановление (ссылка + код), сброс и смена пароля в кабинете.
//
// ПОЧЕМУ ссылка И код одновременно (как в приёме приглашения):
// вход сотрудника открывает рабочее место с медданными пациентов, поэтому одной
// утёкшей половины письма быть недостаточно. В ссылке — подписанный токен;
// код хешируется ВМЕСТЕ с хешем этого токена: sha256(`${код}:${хеш_токена}`).
// Переслал ссылку без кода — она мертва. Подсмотрел код без ссылки — бесполезен.
// В БД лежит только sha256(токена) — тот же приём, что у StaffInvitation.
//
// ЗАЩИТА ОТ ПЕРЕБОРА ПОЧТЫ: requestPasswordReset НИКОГДА не бросает ошибку —
// ни для неизвестного адреса, ни для отключённого сотрудника, ни при кулдауне.
// Контроллер всегда отвечает 200. Иначе эндпоинт превращается в способ узнать,
// работает ли конкретный человек в клинике, — а это само по себе утечка.
//
// Функции:
// - requestPasswordReset — выпустить токен и код, отправить письмо
// - getResetContext      — проверить ссылку для страницы сброса (маскированный email)
// - resetPassword        — ссылка + код + новый пароль
// - changePassword       — сотрудник меняет свой пароль, зная текущий

import crypto from "crypto";
import argon2 from "argon2";

import ClinicEmployee from "../models/clinicEmployee.model.js";

import {
  ValidationError,
  UnauthorizedError,
  ConflictError,
} from "../../../../common/utils/errors.js";
import {
  createSignedToken,
  verifySignedToken,
} from "../../../../common/utils/signedUrl.js";
import { recordActionAsync } from "../../../audit/index.js";
import logger from "../../../../common/logger.js";

import { sendRichEmail } from "../email/sendInvitationEmail.js";
import { renderPasswordResetEmail } from "../email/passwordResetTemplate.js";

const log = logger.child({ module: "clinic-staff/employee-password" });

// ─── Константы ──────────────────────────────────────────────────

const RESET_TTL_MINUTES = 30; // сколько живёт ссылка и код
const RESET_TOKEN_TTL = `${RESET_TTL_MINUTES}m`;
const RESET_OTP_MAX_ATTEMPTS = 3; // попыток ввода кода
const RESET_REQUEST_COOLDOWN_MS = 60 * 1000; // 1 минута между письмами

// Отличает токен сброса от любого другого подписанного токена в системе,
// чтобы токен из приглашения нельзя было подсунуть сюда.
const TOKEN_PURPOSE = "clinic_employee_password_reset";

// ДОЛЖНО совпадать с параметрами в invitation.service.js — там сотрудник
// задаёт пароль впервые. Иначе хеши будут разной формы, и защита от timing-атак
// в employeeAuth.service.js (DUMMY_HASH) перестанет работать корректно.
export const ARGON2_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
});

// ─── Вспомогательные функции ────────────────────────────────────

const sha256 = (v) =>
  crypto.createHash("sha256").update(String(v)).digest("hex");

const normalizeEmail = (v) => String(v).trim().toLowerCase();

function generateOtp() {
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(6, "0");
}

function hashOtp(otp, tokenHash) {
  return sha256(`${otp}:${tokenHash}`);
}

function buildResetUrl(token) {
  const base = process.env.FRONTEND_URL || "https://docpats.com";
  return `${base}/clinic/staff-reset-password?token=${encodeURIComponent(token)}`;
}

/** Сравнение двух hex-хешей за постоянное время. */
function hashesEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/** l***a@gmail.com — безопасно показать на странице сброса. */
function maskEmail(email) {
  if (!email || !email.includes("@")) return null;
  const [local, domain] = email.split("@");
  const head = local.slice(0, 1);
  const tail = local.length > 1 ? local.slice(-1) : "";
  return `${head}${"*".repeat(Math.max(local.length - 2, 1))}${tail}@${domain}`;
}

export async function hashPassword(plain) {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

/** Стереть все следы сброса: при успехе, при исчерпании попыток, при новом запросе. */
function clearResetState(employee) {
  employee.passwordResetTokenHash = null;
  employee.passwordResetOtpHash = null;
  employee.passwordResetExpiresAt = null;
  employee.passwordResetAttemptsLeft = 0;
}

/** Кому нельзя войти — тому нельзя и восстановить пароль. */
function canAuthenticate(employee) {
  return (
    Boolean(employee) &&
    employee.isPlatformDeleted !== true &&
    employee.isActive !== false &&
    employee.isBlocked !== true
  );
}

/** Актор для аудита. Расшифрованных ПДн здесь быть не должно. */
function auditActor(employee) {
  return { userId: String(employee._id), role: "employee" };
}

// ───────────────────────────────────────────────────────────────
// 1. ЗАПРОС СБРОСА (публичный) — никогда не бросает ошибку
// ───────────────────────────────────────────────────────────────

/**
 * Выпустить токен и код, отправить письмо.
 *
 * Молча завершается в ЛЮБОМ отрицательном случае (неизвестный email, отключённый
 * сотрудник, кулдаун, недоступная почта), чтобы вызывающий не мог отличить их
 * от успеха. Контроллер в любом случае отвечает 200.
 *
 * @param {object} args
 * @param {string} args.email
 * @param {string} [args.language] — язык письма (с формы). Неизвестный/пустой →
 *   откат на язык из профиля сотрудника.
 * @param {object} [args.context] — { ipAddress, userAgent, sessionId } для аудита
 * @returns {Promise<{emailSent: boolean}>}
 */
export async function requestPasswordReset({ email, language, context = {} }) {
  const emailHash = sha256(normalizeEmail(email));

  const employee = await ClinicEmployee.findOne({ emailHash });

  if (!canAuthenticate(employee)) {
    log.info(
      { emailHash, found: Boolean(employee) },
      "Запрос сброса пароля для неизвестной или неактивной учётной записи — игнорируем",
    );
    return { emailSent: false };
  }

  // Кулдаун. Молча: бросить здесь RateLimitError — значит подтвердить, что такой
  // сотрудник существует, а именно это мы и не хотим раскрывать.
  const lastRequest = employee.passwordResetRequestedAt;
  if (
    lastRequest &&
    Date.now() - new Date(lastRequest).getTime() < RESET_REQUEST_COOLDOWN_MS
  ) {
    log.info(
      { employeeId: String(employee._id) },
      "Запрос сброса пароля отклонён кулдауном",
    );
    return { emailSent: false };
  }

  const token = createSignedToken(
    { employeeId: String(employee._id), purpose: TOKEN_PURPOSE },
    RESET_TOKEN_TTL,
  );
  const tokenHash = sha256(token);
  const otp = generateOtp();

  // Новый запрос отменяет предыдущий — старая ссылка перестаёт работать.
  employee.passwordResetTokenHash = tokenHash;
  employee.passwordResetOtpHash = hashOtp(otp, tokenHash);
  employee.passwordResetExpiresAt = new Date(
    Date.now() + RESET_TTL_MINUTES * 60 * 1000,
  );
  employee.passwordResetAttemptsLeft = RESET_OTP_MAX_ATTEMPTS;
  employee.passwordResetRequestedAt = new Date();
  await employee.save();

  const { email: plainEmail, firstName } = employee.decryptFields();

  // Язык письма: то, что выбрано на форме сейчас, иначе — язык профиля.
  const SUPPORTED_LANGUAGES = ["ru", "en", "tr", "az", "ar"];
  const emailLanguage = SUPPORTED_LANGUAGES.includes(language)
    ? language
    : employee.preferredLanguage;

  const { subject, htmlContent } = renderPasswordResetEmail({
    language: emailLanguage,
    firstName,
    otp,
    resetUrl: buildResetUrl(token),
    expiresInMinutes: RESET_TTL_MINUTES,
  });

  let emailSent = false;
  try {
    emailSent = await sendRichEmail({ to: plainEmail, subject, htmlContent });
  } catch (err) {
    log.error(
      { err, employeeId: String(employee._id) },
      "Не удалось отправить письмо восстановления пароля",
    );
  }

  // metadata: только структурные данные — ни токена, ни кода, ни адреса.
  recordActionAsync({
    actor: auditActor(employee),
    action: "auth.password_reset_request",
    resourceType: "clinic-employee",
    resourceId: employee._id,
    resourceOwnerId: employee._id,
    outcome: "success",
    context,
    metadata: { emailSent, expiresInMinutes: RESET_TTL_MINUTES },
  });

  return { emailSent };
}

// ───────────────────────────────────────────────────────────────
// 2. ПРОВЕРКА ССЫЛКИ (публичная) — для отрисовки страницы сброса
// ───────────────────────────────────────────────────────────────

/**
 * Найти сотрудника по токену из ссылки.
 * На любую проблему бросает ConflictError с одним и тем же текстом: страница
 * показывает единое состояние «ссылка недействительна или истекла», и мы
 * намеренно не разделяем «подделана» / «истекла» / «уже использована».
 */
async function loadByResetToken(token) {
  const invalid = () =>
    new ConflictError("Reset link is invalid or has expired");

  let payload;
  try {
    payload = verifySignedToken(token);
  } catch {
    throw invalid();
  }

  if (payload?.purpose !== TOKEN_PURPOSE || !payload?.employeeId) {
    throw invalid();
  }

  const tokenHash = sha256(token);
  const employee = await ClinicEmployee.findOne({
    _id: payload.employeeId,
    passwordResetTokenHash: tokenHash,
  });

  // Не нашли — ссылку уже использовали либо её отменил более новый запрос.
  if (!employee || !canAuthenticate(employee)) {
    throw invalid();
  }

  if (
    !employee.passwordResetExpiresAt ||
    employee.passwordResetExpiresAt < new Date()
  ) {
    clearResetState(employee);
    await employee.save();
    throw invalid();
  }

  return { employee, tokenHash };
}

/**
 * Проверить ссылку и описать её странице сброса (страница неавторизованная).
 * Возвращаем ТОЛЬКО замаскированный email — чтобы тот, кто держит ссылку в
 * руках, не узнал из неё полный адрес сотрудника.
 *
 * @param {object} args
 * @param {string} args.token
 * @returns {Promise<{maskedEmail: string|null, expiresAt: Date, attemptsLeft: number}>}
 */
export async function getResetContext({ token }) {
  const { employee } = await loadByResetToken(token);
  const { email } = employee.decryptFields();

  return {
    maskedEmail: maskEmail(email),
    expiresAt: employee.passwordResetExpiresAt,
    attemptsLeft: employee.passwordResetAttemptsLeft,
  };
}

// ───────────────────────────────────────────────────────────────
// 3. УСТАНОВКА НОВОГО ПАРОЛЯ (публичная) — ссылка + код + пароль
// ───────────────────────────────────────────────────────────────

/**
 * Завершить восстановление. Ссылка сгорает и при успехе, и на последней
 * неудачной попытке — то есть у укравшего ссылку есть не больше трёх попыток
 * угадать 6-значный код.
 *
 * @param {object} args
 * @param {string} args.token
 * @param {string} args.otp
 * @param {string} args.password  — новый пароль
 * @param {object} [args.context]
 * @returns {Promise<{success: true}>}
 */
export async function resetPassword({ token, otp, password, context = {} }) {
  const { employee, tokenHash } = await loadByResetToken(token);

  if (employee.passwordResetAttemptsLeft <= 0) {
    clearResetState(employee);
    await employee.save();
    throw new ConflictError("Reset link is invalid or has expired");
  }

  const expected = employee.passwordResetOtpHash;
  const provided = hashOtp(otp, tokenHash);

  if (!expected || !hashesEqual(expected, provided)) {
    employee.passwordResetAttemptsLeft -= 1;
    const attemptsLeft = employee.passwordResetAttemptsLeft;

    // Попытки кончились — сжигаем ссылку целиком, а не только счётчик.
    if (attemptsLeft <= 0) {
      clearResetState(employee);
    }
    await employee.save();

    recordActionAsync({
      actor: auditActor(employee),
      action: "auth.password_reset_request",
      resourceType: "clinic-employee",
      resourceId: employee._id,
      resourceOwnerId: employee._id,
      outcome: "failure",
      failureReason: "Invalid reset code",
      context,
      metadata: { attemptsLeft },
    });

    throw new ValidationError("Invalid or expired code", { attemptsLeft });
  }

  employee.passwordHash = await hashPassword(password);
  clearResetState(employee);
  employee.passwordResetRequestedAt = null;
  employee.lastPasswordChangeAt = new Date();
  employee.mustChangePassword = false;
  // Успешный сброс — это ещё и выход из блокировки после неудачных входов.
  employee.failedLoginAttempts = 0;
  employee.lockoutUntil = null;
  await employee.save();

  log.info(
    { employeeId: String(employee._id) },
    "Пароль сотрудника восстановлен",
  );

  recordActionAsync({
    actor: auditActor(employee),
    action: "auth.password_change",
    resourceType: "clinic-employee",
    resourceId: employee._id,
    resourceOwnerId: employee._id,
    outcome: "success",
    context,
    metadata: { via: "reset_link" },
  });

  return { success: true };
}

// ───────────────────────────────────────────────────────────────
// 4. СМЕНА ПАРОЛЯ В КАБИНЕТЕ (сотрудник уже вошёл)
// ───────────────────────────────────────────────────────────────

/**
 * Требуем ТЕКУЩИЙ пароль — чтобы одной угнанной сессии было мало для того,
 * чтобы запереть настоящего владельца снаружи.
 *
 * @param {object} args
 * @param {string} args.employeeId — из req.session.employeeId
 * @param {string} args.currentPassword
 * @param {string} args.newPassword
 * @param {object} [args.context]
 * @returns {Promise<{success: true}>}
 */
export async function changePassword({
  employeeId,
  currentPassword,
  newPassword,
  context = {},
}) {
  const employee = await ClinicEmployee.findById(employeeId);

  if (!canAuthenticate(employee)) {
    throw new UnauthorizedError("Not authenticated");
  }

  let currentValid = false;
  try {
    currentValid = await argon2.verify(employee.passwordHash, currentPassword);
  } catch {
    currentValid = false;
  }

  if (!currentValid) {
    log.warn(
      { employeeId: String(employee._id) },
      "Смена пароля отклонена — неверный текущий пароль",
    );

    recordActionAsync({
      actor: auditActor(employee),
      action: "auth.password_change",
      resourceType: "clinic-employee",
      resourceId: employee._id,
      resourceOwnerId: employee._id,
      outcome: "denied",
      failureReason: "Current password is incorrect",
      context,
    });

    throw new UnauthorizedError("Current password is incorrect");
  }

  let sameAsOld = false;
  try {
    sameAsOld = await argon2.verify(employee.passwordHash, newPassword);
  } catch {
    sameAsOld = false;
  }
  if (sameAsOld) {
    throw new ValidationError(
      "New password must differ from the current one",
      {},
    );
  }

  employee.passwordHash = await hashPassword(newPassword);
  employee.lastPasswordChangeAt = new Date();
  employee.mustChangePassword = false;
  // Если сотрудник сам сменил пароль — висящая ссылка восстановления не нужна.
  clearResetState(employee);
  employee.passwordResetRequestedAt = null;
  await employee.save();

  log.info(
    { employeeId: String(employee._id) },
    "Сотрудник сменил пароль в кабинете",
  );

  recordActionAsync({
    actor: auditActor(employee),
    action: "auth.password_change",
    resourceType: "clinic-employee",
    resourceId: employee._id,
    resourceOwnerId: employee._id,
    outcome: "success",
    context,
    metadata: { via: "self_service" },
  });

  return { success: true };
}

// Экспорт только для тестов.
export const __test__ = {
  RESET_TTL_MINUTES,
  RESET_OTP_MAX_ATTEMPTS,
  RESET_REQUEST_COOLDOWN_MS,
  TOKEN_PURPOSE,
  sha256,
  hashOtp,
  maskEmail,
  buildResetUrl,
};
