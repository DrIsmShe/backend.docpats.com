// server/modules/payments/providers/stripe.provider.js
// ─────────────────────────────────────────────────────────────────────
//   Адаптер Stripe (глобальный). Включается только когда задан
//     STRIPE_SECRET_KEY (+ STRIPE_WEBHOOK_SECRET для проверки webhook).
//
//   ВНИМАНИЕ: Stripe не сеттлит AZN и недоступен для регистрации в
//   Азербайджане — использовать только если есть юрлицо в поддерживаемой
//   стране. Пока это ЗАГЛУШКА, как и iyzico.
// ─────────────────────────────────────────────────────────────────────

const stripeProvider = {
  name: "stripe",

  isConfigured() {
    return Boolean(process.env.STRIPE_SECRET_KEY);
  },

  async createSubscriptionCheckout() {
    // TODO: Stripe Checkout Session, когда будут ключи.
    throw new Error(
      "stripe provider is not implemented yet — set PAYMENTS_PROVIDER=mock until keys/integration are ready",
    );
  },
};

export default stripeProvider;
