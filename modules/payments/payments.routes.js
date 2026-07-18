// server/modules/payments/payments.routes.js
// ─────────────────────────────────────────────────────────────────────
//   Роуты платежей (после session-middleware).
//   Монтируется: app.use("/api/payments", paymentsRouter)
// ─────────────────────────────────────────────────────────────────────

import express from "express";
import { getPlans, getMySubscription } from "./controllers/pricing.controller.js";
import {
  createSubscriptionCheckout,
  confirmMockPayment,
} from "./controllers/checkout.controller.js";

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res
      .status(401)
      .json({ success: false, message: "Not authenticated" });
  }
  next();
}

// Публичный прайс-лист (для страницы тарифов).
router.get("/plans", getPlans);

// Текущая подписка юзера.
router.get("/my-subscription", requireAuth, getMySubscription);

// Начать оплату подписки.
router.post("/subscribe", requireAuth, createSubscriptionCheckout);

// Подтверждение оплаты для ТЕСТОВОГО (mock) провайдера.
router.post("/mock/confirm", requireAuth, confirmMockPayment);

export default router;
