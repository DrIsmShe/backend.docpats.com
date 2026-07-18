// server/modules/payments/providers/iyzico.provider.js
// ─────────────────────────────────────────────────────────────────────
//   Адаптер iyzico (рынок TR/AZ, локальные карты, TRY/AZN).
//   Включается только когда заданы боевые/sandbox ключи:
//     IYZICO_API_KEY, IYZICO_SECRET, IYZICO_BASE_URL
//       (sandbox: https://sandbox-api.iyzipay.com)
//       (prod:    https://api.iyzipay.com)
//
//   Пока это ЗАГЛУШКА: реальный вызов iyzico Checkout Form подключим,
//   когда придут sandbox-ключи. До тех пор isConfigured() = false, и
//   модуль работает через mock-провайдер.
// ─────────────────────────────────────────────────────────────────────

const iyzicoProvider = {
  name: "iyzico",

  isConfigured() {
    return Boolean(
      process.env.IYZICO_API_KEY &&
        process.env.IYZICO_SECRET &&
        process.env.IYZICO_BASE_URL,
    );
  },

  async createSubscriptionCheckout() {
    // TODO: реализовать iyzico Checkout Form Initialize, когда будут ключи.
    // Сейчас — явная ошибка, чтобы случайно не «оплатить» вникуда.
    throw new Error(
      "iyzico provider is not implemented yet — set PAYMENTS_PROVIDER=mock until keys/integration are ready",
    );
  },
};

export default iyzicoProvider;
