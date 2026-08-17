// server/common/video/videoQuota.service.js
// ─────────────────────────────────────────────────────────────────────
//   Месячная квота минут видео/аудио по тарифу.
//
//   ЗАЧЕМ. Минуты стояли в прайсе всех тарифов — от 30 у бесплатного
//   пациента до 15 000 у клиники — и не читались ни одной строкой кода.
//   Видеосервер стоит денег, а «1200 минут (20 ч)» на карточке было
//   украшением, ровно как комиссия и квоты разборов до сегодня.
//
//   ЧТО СЧИТАЕМ. Фактические записи журнала звонков (CallLog): сумму
//   durationSec там, где человек был любой из сторон. Счётчик в памяти
//   обнулялся бы при каждом деплое, а деплой у нас случается часто.
//
//   ОКНО СКОЛЬЗЯЩЕЕ — 30 дней назад от «сейчас», а не календарный месяц.
//   Так же считается месячная квота разборов; человек, начавший
//   пользоваться 28-го, иначе получил бы полный лимит за три дня.
//
//   ГДЕ ПРИМЕНЯЕТСЯ. В момент выдачи токена на комнату, то есть до входа
//   в звонок. Прерывать разговор на середине из-за квоты нельзя: это
//   медицинская консультация, а не подписка на кино. Поэтому проверка
//   стоит на входе, а перерасход внутри уже начатого звонка допускается.
// ─────────────────────────────────────────────────────────────────────

import CallLog from "../models/Communication/callLog.js";
import User from "../models/Auth/users.js";
import {
  resolveEffectivePlan,
  getLimit,
  PLAN_DISPLAY_NAMES,
} from "../config/aiPlanLimits.js";
import { ValidationError } from "../utils/errors.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;

/**
 * Сколько секунд человек уже наговорил за окно.
 *
 * callerUserId/calleeUserId в журнале — строки, а не ObjectId (так
 * объявлена модель), поэтому и сравниваем строками.
 */
export async function videoSecondsUsed(userId, now = Date.now()) {
  const id = String(userId);
  const rows = await CallLog.find({
    startedAt: { $gte: new Date(now - MONTH_MS) },
    $or: [{ callerUserId: id }, { calleeUserId: id }],
  })
    .select("durationSec")
    .lean();

  return rows.reduce((sum, r) => sum + (r.durationSec || 0), 0);
}

/** План человека и его месячная квота минут. null — квоту не применяем. */
async function planQuota(userId) {
  const user = await User.findById(userId)
    .select("role subscriptionPlan subscriptionEndsAt trialEndsAt")
    .lean();

  // Пользователя нет (служебный вызов, удалённый аккаунт) — не применяем
  // предел, но и не врём: звонок важнее строгости учёта.
  if (!user) return null;

  const plan = resolveEffectivePlan(user);
  const limit = getLimit(plan, "videoMinutes");

  // 0 — фича у плана не описана, -1 — безлимит. Ни то, ни другое не
  // повод отказывать.
  if (!limit || limit < 0) return null;

  return { plan, limit };
}

/**
 * Проверить, можно ли входить в звонок. Бросает ValidationError с
 * понятным текстом, если минуты кончились.
 *
 * @param {string|object} userId — кто входит
 * @param {number} [now]
 */
export async function assertVideoAllowed(userId, now = Date.now()) {
  if (!userId) return;

  const quota = await planQuota(userId);
  if (!quota) return;

  const usedMin = Math.floor((await videoSecondsUsed(userId, now)) / 60);
  if (usedMin < quota.limit) return;

  const planName = PLAN_DISPLAY_NAMES[quota.plan] || quota.plan;
  throw new ValidationError(
    `Исчерпаны минуты видео тарифа ${planName} (${quota.limit} в месяц). ` +
      `Использовано ${usedMin}. Минуты освобождаются постепенно: счёт идёт ` +
      `за последние 30 дней. Либо перейдите на старший тариф.`,
    {
      limit: "videoMinutesPerMonth",
      plan: quota.plan,
      planLimit: quota.limit,
      used: usedMin,
    },
  );
}

/** Остаток — чтобы интерфейс показал его до начала звонка. */
export async function videoQuotaLeft(userId, now = Date.now()) {
  const quota = await planQuota(userId);
  const usedMin = Math.floor((await videoSecondsUsed(userId, now)) / 60);

  if (!quota) return { used: usedMin, limit: null, plan: null };
  return {
    used: usedMin,
    limit: quota.limit,
    plan: quota.plan,
    remaining: Math.max(0, quota.limit - usedMin),
  };
}

export default { assertVideoAllowed, videoQuotaLeft, videoSecondsUsed };
