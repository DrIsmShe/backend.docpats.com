// server/modules/payments/providers/mock.provider.js
// ─────────────────────────────────────────────────────────────────────
//   Тестовый провайдер — НЕ списывает реальные деньги.
//   Используется по умолчанию (PAYMENTS_PROVIDER=mock), пока не подключены
//   боевые ключи iyzico/Stripe. Позволяет прогнать весь поток подписки:
//   создать checkout → «оплатить» на mock-странице → активировать план.
// ─────────────────────────────────────────────────────────────────────

const mockProvider = {
  name: "mock",

  isConfigured() {
    return true; // всегда доступен
  },

  // Возвращает URL «страницы оплаты». Для mock это фронтовая заглушка,
  // которая затем дёрнет POST /api/payments/mock/confirm.
  async createSubscriptionCheckout({ tx, frontendUrl }) {
    const providerRef = `mock_${tx._id.toString()}`;
    const checkoutUrl = `${frontendUrl}/payment/mock?tx=${tx._id.toString()}`;
    return { checkoutUrl, providerRef };
  },
};

export default mockProvider;
