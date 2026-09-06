// server/common/middlewares/requireAi.js
//
// ЖЁСТКИЙ ВЫКЛЮЧАТЕЛЬ ИИ ПО ТАРИФУ.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ГЕЙТ. Квота-сервисы трактуют лимит 0/undefined как «предел
// не применять» (0 = безлимит). Значит выключить ИИ занижением числа нельзя —
// вышло бы наоборот. Бесплатный врачебный тариф doctor_free (тарифная сетка
// v5) обязан быть БЕЗ ИИ вовсе, поэтому проверка идёт до квоты и до вызова
// модели: план в AI_DISABLED_PLANS → отказ.
//
// КОГО РЕЖЕТ. Только planHasAI()===false, сейчас это doctor_free. Гость и
// patient_free сохраняют своё метрованное демо (их считают сами сервисы) —
// для пациента помощник и есть продукт.
//
// ДВА ВХОДА. assertAiEnabled(user) — для сервисов, где документ User уже на
// руках; requireAi — express-middleware на AI-маршруты. Оба опираются на один
// planHasAI(), так что разъехаться не могут.

import User from "../models/Auth/users.js";
import {
  resolveEffectivePlan,
  planHasAI,
} from "../config/aiPlanLimits.js";
import { AppError } from "../utils/errors.js";

/**
 * ИИ выключен тарифом. 402 (а не 403): это не «нет прав», а «нет на вашем
 * тарифе — оформите подписку». 402 позволяет клиенту показать апселл вместо
 * страницы ошибки, ровно как QuotaExceededError.
 */
export class AiNotOnPlanError extends AppError {
  constructor(plan) {
    super(
      "ИИ недоступен на бесплатном тарифе. Оформите подписку, чтобы включить ИИ.",
      402,
      "AI_NOT_ON_PLAN",
      { plan, i18n: "app.ai.notOnPlan" },
    );
  }
}

/**
 * Бросает AiNotOnPlanError, если у эффективного плана пользователя ИИ
 * выключен. Гость (user=null) → план "guest" → ИИ есть (демо), не бросает.
 *
 * @param {Object|null} user — документ User (lean допустим)
 * @returns {String} эффективный план (для дальнейшего расчёта квоты)
 */
export function assertAiEnabled(user) {
  const plan = resolveEffectivePlan(user);
  if (!planHasAI(plan)) throw new AiNotOnPlanError(plan);
  return plan;
}

/**
 * Express-middleware для AI-маршрутов. Кладётся ПОСЛЕ session/auth.
 *
 * req.user — документ User (authMiddleware кладёт его целиком). Если его нет,
 * поднимаем по req.session.userId. Совсем без пользователя (гость) —
 * пропускаем: гейт бьёт только по вошедшему тарифу без ИИ.
 */
export default async function requireAi(req, res, next) {
  try {
    let user = req.user;
    if (!user && req.session?.userId) {
      user = await User.findById(req.session.userId)
        .select("role subscriptionPlan subscriptionEndsAt trialEndsAt")
        .lean();
    }
    if (!user) return next();

    const plan = resolveEffectivePlan(user);
    if (!planHasAI(plan)) {
      return res.status(402).json({
        success: false,
        code: "AI_NOT_ON_PLAN",
        message:
          "ИИ недоступен на бесплатном тарифе. Оформите подписку, чтобы включить ИИ.",
        i18n: "app.ai.notOnPlan",
        plan,
      });
    }
    next();
  } catch (err) {
    next(err);
  }
}
