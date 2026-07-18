// server/modules/payments/models/paymentTransaction.js
// ─────────────────────────────────────────────────────────────────────
//   Журнал платёжных операций (ledger). Одна запись = одна попытка
//   оплаты (подписка врача/пациента или оплата приёма).
//
//   Это НЕ PHI: тут только структурные/финансовые данные — суммы, план,
//   провайдер, статус. Имён/диагнозов быть не должно.
//
//   Источник правды по активной подписке — поля в модели User
//   (subscriptionPlan / subscriptionEndsAt). Этот журнал нужен для
//   аудита платежей, сверки с провайдером и истории списаний.
// ─────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";

const paymentTransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Что оплачивается
    kind: {
      type: String,
      enum: ["subscription", "appointment"],
      default: "subscription",
    },

    // Для подписок
    planKey: { type: String, default: null }, // doctor_super, patient_pro, ...
    period: {
      type: String,
      enum: ["monthly", "yearly", null],
      default: null,
    },

    // Для оплаты приёма
    appointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      default: null,
    },

    // Деньги
    amount: { type: Number, required: true }, // в валюте платежа
    currency: { type: String, default: "USD" },

    // Провайдер и его идентификаторы
    provider: {
      type: String,
      enum: ["mock", "iyzico", "stripe", "local"],
      required: true,
    },
    providerRef: { type: String, default: null }, // checkoutId / paymentIntentId / token

    // Жизненный цикл
    status: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded", "cancelled"],
      default: "pending",
      index: true,
    },
    paidAt: { type: Date, default: null },
    failedReason: { type: String, default: null },

    // Только структурные данные — НЕ PHI
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

paymentTransactionSchema.index({ userId: 1, createdAt: -1 });

// Гвард от повторного mongoose.model() при ре-импорте (vitest / nodemon)
const PaymentTransaction =
  mongoose.models.PaymentTransaction ||
  mongoose.model("PaymentTransaction", paymentTransactionSchema);

export default PaymentTransaction;
