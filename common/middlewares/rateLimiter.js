import rateLimit from "express-rate-limit";

const emailLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 минута
  max: 10, // Разрешено 10 запросов в минуту
  message: "Слишком много попыток, попробуйте позже",
});

// Ограничители считают запросы по IP и хранят счётчики в памяти процесса.
// Под vitest все тест-файлы идут в одном процессе, счётчики протекали бы между
// тестами и роняли их случайным образом. Поэтому в тестах — выключаем.
// (В CI переменная NODE_ENV=test выставлена.)
const skipInTests = () => process.env.NODE_ENV === "test";

/**
 * Тормоз для подбора паролей на входе.
 * Дополняет блокировку самой учётной записи (failedLoginAttempts / lockoutUntil):
 * блокировка защищает один аккаунт от долбёжки, а этот лимитер — от перебора
 * многих аккаунтов с одного адреса.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTests,
  message: { error: "Too many login attempts. Try again later." },
});

/**
 * Тормоз для запросов восстановления пароля — каждый такой запрос отправляет
 * письмо, так что без лимита это и спам-пушка, и инструмент перебора адресов.
 * Кулдаун на конкретного сотрудника живёт в employeePassword.service.js.
 */
export const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTests,
  message: { error: "Too many password reset requests. Try again later." },
});

export default emailLimiter;
