// server/modules/payments/services/subscription.service.js
// ─────────────────────────────────────────────────────────────────────
//   Бизнес-логика подписок: валидация плана под роль, расчёт цены и даты
//   окончания, активация плана на модели User.
//
//   Источник цен/планов — common/config/aiPlanLimits.js (единый источник
//   правды). Здесь мы НЕ дублируем цены, а читаем их оттуда.
// ─────────────────────────────────────────────────────────────────────

import { PLAN_PRICES } from "../../../common/config/aiPlanLimits.js";

// Какие роли имеют право покупать какой план.
const PLAN_ALLOWED_ROLES = {
  patient_std: ["patient", "user"],
  patient_pro: ["patient", "user"],
  doctor_basic: ["doctor"],
  doctor_super: ["doctor"],
  doctor_pro: ["doctor"],
  clinic_start: ["doctor"],
  clinic: ["doctor"],
  clinic_pro: ["doctor"],
};

/**
 * Проверяет, что план существует, у него есть цена и роль юзера вправе
 * его покупать. Бросает Error с понятным сообщением, если нет.
 */
export function assertPlanAllowed(planKey, period, role) {
  if (!PLAN_PRICES[planKey]) {
    throw new Error(`Unknown or non-purchasable plan: ${planKey}`);
  }
  if (period !== "monthly" && period !== "yearly") {
    throw new Error(`Invalid period: ${period} (expected monthly|yearly)`);
  }
  const allowed = PLAN_ALLOWED_ROLES[planKey];
  if (!allowed || !allowed.includes(role)) {
    throw new Error(`Role "${role}" cannot purchase plan "${planKey}"`);
  }
}

/**
 * Цена плана в USD за выбранный период.
 */
export function getPlanAmount(planKey, period) {
  const price = PLAN_PRICES[planKey];
  if (!price) return 0;
  return price[period] || 0;
}

/**
 * Считает дату окончания оплаченного периода. Если у юзера ещё активна
 * прошлая подписка — продлеваем от её конца (стекинг), иначе от now.
 */
export function computeSubscriptionEnd(period, currentEndsAt, now) {
  const base =
    currentEndsAt && new Date(currentEndsAt) > now
      ? new Date(currentEndsAt)
      : new Date(now);
  const end = new Date(base);
  if (period === "yearly") {
    end.setFullYear(end.getFullYear() + 1);
  } else {
    end.setMonth(end.getMonth() + 1);
  }
  return end;
}

/**
 * Активирует подписку на модели User после успешной оплаты.
 * Вызывается из webhook (боевые провайдеры) или из mock-confirm.
 *
 * @param {Object} user  — документ User (mongoose)
 * @param {Object} opts  — { planKey, period, provider, providerRef, now }
 * @returns {Object} краткая сводка активной подписки
 */
export async function activateSubscription(user, opts) {
  const { planKey, period } = opts;
  const now = opts.now instanceof Date ? opts.now : new Date();

  assertPlanAllowed(planKey, period, user.role);

  user.subscriptionPlan = planKey;
  user.subscriptionPeriod = period;
  user.subscriptionEndsAt = computeSubscriptionEnd(
    period,
    user.subscriptionEndsAt,
    now,
  );
  user.paymentLastChargedAt = now;

  await user.save({ validateModifiedOnly: true });

  return {
    subscriptionPlan: user.subscriptionPlan,
    subscriptionPeriod: user.subscriptionPeriod,
    subscriptionEndsAt: user.subscriptionEndsAt,
  };
}
