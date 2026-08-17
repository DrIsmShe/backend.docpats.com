// server/modules/labInsight/services/labInsightQuota.service.js
//
// Месячная квота расшифровок бланка.
//
// Расшифровка — два обращения к модели: чтение бланка (много входных
// токенов, изображение) и объяснение. По цене это примерно консультация,
// и считать её надо отдельно, а не списывать с консультаций: это разные
// поводы прийти, и человек, потративший разбор анализа, не должен
// обнаружить, что у него кончились вопросы к помощнику.
//
// ОКНО СКОЛЬЗЯЩЕЕ — 30 дней назад от «сейчас», как у разборов и минут
// видео. Календарный месяц заставляет ждать первого числа: сдавший
// анализы 28-го получил бы полную квоту за три дня.

import LabInsight from "../models/labInsight.model.js";
import User from "../../../common/models/Auth/users.js";
import {
  resolveEffectivePlan,
  getLimit,
  PLAN_DISPLAY_NAMES,
} from "../../../common/config/aiPlanLimits.js";
import { ValidationError } from "../../../common/utils/errors.js";

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/** Сколько расшифровок сделано за последние 30 дней. */
export async function usedInWindow(userId, now = Date.now()) {
  return LabInsight.countDocuments({
    userId,
    createdAt: { $gte: new Date(now - MONTH_MS) },
  });
}

/** План пользователя и его предел. null — предел неприменим. */
async function planQuota(userId) {
  const user = await User.findById(userId)
    .select("role subscriptionPlan subscriptionEndsAt trialEndsAt")
    .lean();
  if (!user) return null;

  const plan = resolveEffectivePlan(user);
  const limit = getLimit(plan, "labExplanations");

  // 0 — фича у плана не описана, -1 — безлимит. Ни то, ни другое не
  // повод отказывать.
  if (!limit || limit < 0) return null;

  return { plan, limit };
}

/**
 * Проверить квоту ДО обращения к модели.
 *
 * Порядок принципиален: отказ, за который мы заплатили два вызова
 * модели, — худший вид отказа, и повторять его можно бесконечно.
 */
export async function assertLabInsightAllowed(userId, now = Date.now()) {
  const quota = await planQuota(userId);
  if (!quota) return null;

  const used = await usedInWindow(userId, now);
  if (used < quota.limit) return { ...quota, used };

  const planName = PLAN_DISPLAY_NAMES[quota.plan] || quota.plan;
  throw new ValidationError(
    `Расшифровки анализов на тарифе ${planName} закончились: ` +
      `${used} из ${quota.limit} за 30 дней. Квота восстанавливается ` +
      `постепенно — по мере того, как прошлые разборы выходят за окно.`,
    { feature: "labExplanations", plan: quota.plan, limit: quota.limit, used },
  );
}

/** Остаток — для интерфейса. */
export async function labInsightQuotaLeft(userId, now = Date.now()) {
  const quota = await planQuota(userId);
  if (!quota) return { unlimited: true, used: 0, limit: null, left: null };

  const used = await usedInWindow(userId, now);
  return {
    unlimited: false,
    plan: quota.plan,
    limit: quota.limit,
    used,
    left: Math.max(0, quota.limit - used),
  };
}

export default {
  assertLabInsightAllowed,
  labInsightQuotaLeft,
  usedInWindow,
};
