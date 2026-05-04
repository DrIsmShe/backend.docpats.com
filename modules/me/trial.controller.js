// server/modules/me/trial.controller.js
// ─────────────────────────────────────────────────────────────────────
//   GET /api/me/trial-status
//
//   Возвращает информацию о trial-периоде текущего юзера:
//   - isInTrial: bool
//   - daysLeft: number | null
//   - trialEndsAt: ISO date | null
//   - plan: эффективный план (через resolveEffectivePlan)
//   - hasActiveSubscription: bool — есть ли платная подписка
//
//   Используется компонентом <TrialBanner /> в шапке/сайдбаре врача.
// ─────────────────────────────────────────────────────────────────────

import User from "../../common/models/Auth/users.js";
import {
  resolveEffectivePlan,
  PLAN_DISPLAY_NAMES,
} from "../../common/config/aiPlanLimits.js";

export async function getTrialStatus(req, res) {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated",
      });
    }

    const user = await User.findById(userId)
      .select("role trialEndsAt subscriptionPlan subscriptionEndsAt")
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const now = new Date();
    const trialEnd = user.trialEndsAt ? new Date(user.trialEndsAt) : null;
    const isInTrial = trialEnd ? now < trialEnd : false;

    const daysLeft = trialEnd
      ? Math.max(
          0,
          Math.ceil(
            (trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
          ),
        )
      : null;

    const plan = resolveEffectivePlan(user);
    const planLabel = PLAN_DISPLAY_NAMES[plan] || plan;

    // Есть ли платная подписка (не trial и не free)
    const PAID_PLANS = [
      "patient_std",
      "patient_pro",
      "doctor_basic",
      "doctor_super",
      "doctor_pro",
      "clinic_start",
      "clinic",
      "clinic_pro",
    ];
    const hasActiveSubscription = PAID_PLANS.includes(user.subscriptionPlan);

    return res.json({
      success: true,
      role: user.role,
      isInTrial,
      daysLeft,
      trialEndsAt: trialEnd ? trialEnd.toISOString() : null,
      plan,
      planLabel,
      hasActiveSubscription,
      subscriptionEndsAt: user.subscriptionEndsAt
        ? new Date(user.subscriptionEndsAt).toISOString()
        : null,
    });
  } catch (error) {
    console.error("❌ getTrialStatus error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch trial status",
    });
  }
}
