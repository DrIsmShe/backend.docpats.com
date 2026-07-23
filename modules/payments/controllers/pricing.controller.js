// server/modules/payments/controllers/pricing.controller.js
// ─────────────────────────────────────────────────────────────────────
//   Публичный прайс-лист + сводка по текущей подписке юзера.
// ─────────────────────────────────────────────────────────────────────

import User from "../../../common/models/Auth/users.js";
import { isPaymentsLive } from "../providers/index.js";
import {
  PLAN_PRICES,
  PLAN_DISPLAY_NAMES,
  PLAN_LIMITS,
  EXAM_ADDONS,
  EXAM_ADDON_PRICES,
  EXAM_ADDON_DISPLAY_NAMES,
  resolveEffectivePlan,
  resolveExamAddon,
} from "../../../common/config/aiPlanLimits.js";

// К какой аудитории относится план — для группировки на странице тарифов.
function audienceOf(planKey) {
  if (planKey.startsWith("patient_")) return "patient";
  if (planKey.startsWith("doctor_")) return "doctor";
  if (planKey.startsWith("clinic")) return "clinic";
  return "other";
}

/**
 * GET /api/payments/plans — публичный список покупаемых планов с ценами
 * (USD) и лимитами. Для страницы тарифов.
 */
export async function getPlans(req, res) {
  try {
    const plans = Object.keys(PLAN_PRICES).map((key) => ({
      key,
      name: PLAN_DISPLAY_NAMES[key] || key,
      audience: audienceOf(key),
      currency: "USD",
      monthly: PLAN_PRICES[key].monthly ?? null,
      yearly: PLAN_PRICES[key].yearly ?? null,
      limits: PLAN_LIMITS[key] || {},
    }));

    // Аддоны идут отдельным списком, а не в plans: они не заменяют план,
    // а надстраиваются над любым — включая бесплатный. Смешивать их с
    // основной сеткой значило бы предлагать выбрать одно из двух.
    const addons = Object.keys(EXAM_ADDONS).map((key) => ({
      key,
      name: EXAM_ADDON_DISPLAY_NAMES[key] || key,
      audience: "any",
      currency: "USD",
      monthly: EXAM_ADDON_PRICES[key]?.monthly ?? null,
      yearly: EXAM_ADDON_PRICES[key]?.yearly ?? null,
      limits: EXAM_ADDONS[key],
    }));

    return res.status(200).json({
      success: true,
      currency: "USD",
      plans,
      addons,
      // Состояние кассы. Интерфейс по нему решает, показывать «Подключить»
      // или «Сообщить о запуске» — и не хранит собственной заглушки, из-за
      // которой в день запуска пришлось бы править компоненты.
      paymentsEnabled: isPaymentsLive(),
    });
  } catch (err) {
    console.error("getPlans error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * GET /api/payments/my-subscription — текущий план юзера с учётом trial.
 */
export async function getMySubscription(req, res) {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Not authenticated" });
    }

    const user = await User.findById(userId).select(
      "role subscriptionPlan subscriptionPeriod subscriptionEndsAt trialEndsAt paymentLastChargedAt examAddon examAddonEndsAt",
    );
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const effectivePlan = resolveEffectivePlan(user);
    const now = new Date();
    const trialActive = user.trialEndsAt && new Date(user.trialEndsAt) > now;

    return res.status(200).json({
      success: true,
      effectivePlan,
      effectivePlanName: PLAN_DISPLAY_NAMES[effectivePlan] || effectivePlan,
      storedPlan: user.subscriptionPlan || null,
      period: user.subscriptionPeriod || null,
      subscriptionEndsAt: user.subscriptionEndsAt || null,
      trial: {
        active: Boolean(trialActive),
        endsAt: user.trialEndsAt || null,
      },
      // Аддон подготовки к экзаменам живёт отдельно от плана: клиенту
      // нужно знать про оба, чтобы не предлагать купить уже купленное.
      examAddon: {
        key: resolveExamAddon(user),
        stored: user.examAddon || null,
        endsAt: user.examAddonEndsAt || null,
        name: user.examAddon
          ? EXAM_ADDON_DISPLAY_NAMES[user.examAddon] || user.examAddon
          : null,
      },
      lastChargedAt: user.paymentLastChargedAt || null,
    });
  } catch (err) {
    console.error("getMySubscription error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}
