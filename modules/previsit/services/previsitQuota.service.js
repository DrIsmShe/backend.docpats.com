// server/modules/previsit/services/previsitQuota.service.js
//
// Квота анкет перед приёмом. Считается на ВРАЧА, а не на пациента:
// анкету приглашает клиника, и бесплатный пациент не должен упираться
// в чужой лимит, заполняя её по просьбе врача.
//
// Окно скользящее (30 дней), как у остальных месячных квот.
//
// Отказ по квоте НЕ роняет анкету: вызывающий код ловит его и сохраняет
// ответы без разбора. Здесь только решение «можно ли звать модель».

import PrevisitIntake from "../models/previsitIntake.model.js";
import User from "../../../common/models/Auth/users.js";
import {
  resolveEffectivePlan,
  getLimit,
  PLAN_DISPLAY_NAMES,
} from "../../../common/config/aiPlanLimits.js";
import { ValidationError } from "../../../common/utils/errors.js";

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/** Сколько анкет РАЗОБРАНО за 30 дней. Считаем разборы, а не приглашения. */
export async function usedInWindow(doctorId, now = Date.now()) {
  return PrevisitIntake.countDocuments({
    doctorId,
    // Только те, где разбор состоялся: приглашение и незаполненная
    // анкета денег не стоят.
    narrative: { $ne: "" },
    submittedAt: { $gte: new Date(now - MONTH_MS) },
  });
}

async function planQuota(doctorId) {
  const user = await User.findById(doctorId)
    .select("role subscriptionPlan subscriptionEndsAt trialEndsAt")
    .lean();
  if (!user) return null;

  const plan = resolveEffectivePlan(user);
  const limit = getLimit(plan, "previsitIntakes");
  if (!limit || limit < 0) return null;

  return { plan, limit };
}

/** Бросает ValidationError, если разбирать анкету уже не на что. */
export async function assertIntakeAllowed(doctorId, now = Date.now()) {
  const quota = await planQuota(doctorId);
  if (!quota) return null;

  const used = await usedInWindow(doctorId, now);
  if (used < quota.limit) return { ...quota, used };

  const planName = PLAN_DISPLAY_NAMES[quota.plan] || quota.plan;
  throw new ValidationError(
    `Разборы анкет на тарифе ${planName} исчерпаны: ${used} из ${quota.limit} за 30 дней`,
    { feature: "previsitIntakes", plan: quota.plan, limit: quota.limit, used },
  );
}

export default { assertIntakeAllowed, usedInWindow };
