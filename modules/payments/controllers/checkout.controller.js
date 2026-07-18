// server/modules/payments/controllers/checkout.controller.js
// ─────────────────────────────────────────────────────────────────────
//   Инициация оплаты подписки и подтверждение (для mock-провайдера).
//
//   Поток:
//     1. POST /api/payments/subscribe { planKey, period }
//        → создаёт запись в ledger (status=pending), спрашивает у активного
//          провайдера checkoutUrl, возвращает его фронту.
//     2. Юзер оплачивает на стороне провайдера.
//        - Боевой провайдер: подтверждение придёт webhook'ом.
//        - mock: фронт-заглушка дёргает POST /api/payments/mock/confirm.
// ─────────────────────────────────────────────────────────────────────

import User from "../../../common/models/Auth/users.js";
import PaymentTransaction from "../models/paymentTransaction.js";
import {
  assertPlanAllowed,
  getPlanAmount,
  activateSubscription,
} from "../services/subscription.service.js";
import {
  getActiveProvider,
  getActiveProviderName,
} from "../providers/index.js";

const isProduction = process.env.NODE_ENV === "production";
const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  (isProduction ? "https://docpats.com" : "http://localhost:3000");

/**
 * POST /api/payments/subscribe — начать оплату подписки.
 */
export async function createSubscriptionCheckout(req, res) {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Not authenticated" });
    }

    const { planKey, period } = req.body || {};
    const user = await User.findById(userId).select(
      "role subscriptionEndsAt",
    );
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Валидация плана под роль (бросит Error → 400).
    try {
      assertPlanAllowed(planKey, period, user.role);
    } catch (e) {
      return res.status(400).json({ success: false, message: e.message });
    }

    const amount = getPlanAmount(planKey, period);
    if (!amount || amount <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Plan price is not configured" });
    }

    const providerName = getActiveProviderName();

    // 1. Запись в журнал (pending).
    const tx = await PaymentTransaction.create({
      userId,
      kind: "subscription",
      planKey,
      period,
      amount,
      currency: "USD",
      provider: providerName,
      status: "pending",
      meta: { role: user.role },
    });

    // 2. Просим провайдера создать checkout.
    const provider = getActiveProvider();
    const { checkoutUrl, providerRef } =
      await provider.createSubscriptionCheckout({
        tx,
        user,
        planKey,
        period,
        amount,
        currency: "USD",
        frontendUrl: FRONTEND_URL,
      });

    if (providerRef) {
      tx.providerRef = providerRef;
      await tx.save();
    }

    return res.status(200).json({
      success: true,
      provider: providerName,
      transactionId: tx._id.toString(),
      checkoutUrl,
      amount,
      currency: "USD",
    });
  } catch (err) {
    console.error("createSubscriptionCheckout error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * POST /api/payments/mock/confirm { transactionId }
 * Подтверждение оплаты для ТЕСТОВОГО провайдера. Реальные провайдеры
 * подтверждаются через webhook — этот эндпоинт работает только когда
 * активен mock.
 */
export async function confirmMockPayment(req, res) {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Not authenticated" });
    }

    if (getActiveProviderName() !== "mock") {
      return res.status(400).json({
        success: false,
        message: "Mock confirm is only available in mock provider mode",
      });
    }

    const { transactionId } = req.body || {};
    if (!transactionId) {
      return res
        .status(400)
        .json({ success: false, message: "transactionId is required" });
    }

    const tx = await PaymentTransaction.findOne({
      _id: transactionId,
      userId, // владелец — только сам юзер
    });
    if (!tx) {
      return res
        .status(404)
        .json({ success: false, message: "Transaction not found" });
    }
    if (tx.status === "paid") {
      return res
        .status(200)
        .json({ success: true, alreadyPaid: true });
    }
    if (tx.status !== "pending") {
      return res
        .status(400)
        .json({ success: false, message: `Transaction is ${tx.status}` });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const summary = await activateSubscription(user, {
      planKey: tx.planKey,
      period: tx.period,
    });

    tx.status = "paid";
    tx.paidAt = new Date();
    await tx.save();

    return res.status(200).json({ success: true, subscription: summary });
  } catch (err) {
    console.error("confirmMockPayment error:", err.message);
    return res
      .status(400)
      .json({ success: false, message: err.message || "Payment failed" });
  }
}
