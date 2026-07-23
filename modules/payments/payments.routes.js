// server/modules/payments/payments.routes.js
// ─────────────────────────────────────────────────────────────────────
//   Роуты платежей (после session-middleware).
//   Монтируется: app.use("/api/payments", paymentsRouter)
// ─────────────────────────────────────────────────────────────────────

import express from "express";
import User from "../../common/models/Auth/users.js";
import { getPlans, getMySubscription } from "./controllers/pricing.controller.js";
import {
  createSubscriptionCheckout,
  confirmMockPayment,
} from "./controllers/checkout.controller.js";
import {
  joinWaitlist,
  listWaitlist,
} from "./controllers/waitlist.controller.js";
import { grantPlanByAdmin } from "./controllers/grant.controller.js";

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res
      .status(401)
      .json({ success: false, message: "Not authenticated" });
  }
  next();
}

async function requireAdmin(req, res, next) {
  try {
    const user = await User.findById(req.session.userId).select("role").lean();
    if (user?.role !== "admin") {
      return res
        .status(403)
        .json({ success: false, message: "Admin only" });
    }
    next();
  } catch {
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * Тестовое подтверждение оплаты — только вне продакшена или админом.
 *
 * До этой проверки любой зарегистрированный пользователь мог выдать себе
 * платный тариф: mock-провайдер активирует подписку по факту нажатия
 * кнопки, без каких-либо денег. Пока касса закрыта, это не потеря
 * выручки, но это «оплаченные» подписки, которых никто не оплачивал —
 * потом их не отличить от настоящих.
 */
async function requireMockConfirmAllowed(req, res, next) {
  if (process.env.NODE_ENV !== "production") return next();
  return requireAdmin(req, res, next);
}

// Публичный прайс-лист (для страницы тарифов).
router.get("/plans", getPlans);

// Текущая подписка юзера.
router.get("/my-subscription", requireAuth, getMySubscription);

// Начать оплату подписки.
router.post("/subscribe", requireAuth, createSubscriptionCheckout);

// Подтверждение оплаты для ТЕСТОВОГО (mock) провайдера.
router.post(
  "/mock/confirm",
  requireAuth,
  requireMockConfirmAllowed,
  confirmMockPayment,
);

// ─── Лист ожидания (пока касса закрыта) ───────────────────────────────
// Открыт без авторизации: интерес к тарифу может оставить и гость,
// который ещё не завёл аккаунт — именно он и есть будущий покупатель.
router.post("/waitlist", joinWaitlist);
router.get("/waitlist", requireAuth, requireAdmin, listWaitlist);

// ─── Ручная выдача тарифа ─────────────────────────────────────────────
// Продажа мимо сайта (перевод, счёт), промо, компенсация, партнёрский
// доступ. Останется нужной и после запуска эквайринга.
router.post("/admin/grant", requireAuth, requireAdmin, grantPlanByAdmin);

export default router;
