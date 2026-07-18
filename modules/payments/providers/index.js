// server/modules/payments/providers/index.js
// ─────────────────────────────────────────────────────────────────────
//   Реестр платёжных провайдеров. Активный выбирается через env
//   PAYMENTS_PROVIDER (mock | iyzico | stripe). По умолчанию — mock,
//   чтобы в проде без ключей ничего не списывалось.
// ─────────────────────────────────────────────────────────────────────

import mockProvider from "./mock.provider.js";
import iyzicoProvider from "./iyzico.provider.js";
import stripeProvider from "./stripe.provider.js";

const PROVIDERS = {
  mock: mockProvider,
  iyzico: iyzicoProvider,
  stripe: stripeProvider,
};

export function getActiveProviderName() {
  return process.env.PAYMENTS_PROVIDER || "mock";
}

export function getProvider(name) {
  const key = name || getActiveProviderName();
  const provider = PROVIDERS[key];
  if (!provider) {
    throw new Error(`Unknown payment provider: ${key}`);
  }
  return provider;
}

export function getActiveProvider() {
  return getProvider(getActiveProviderName());
}
