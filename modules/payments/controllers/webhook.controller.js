// server/modules/payments/controllers/webhook.controller.js
// ─────────────────────────────────────────────────────────────────────
//   Приём webhook'ов от боевых провайдеров (iyzico / Stripe).
//   Монтируется ДО session-middleware и без CSRF-origin-проверки: это
//   server-to-server вызов от платёжного шлюза, а не браузерный запрос.
//
//   Пока боевые провайдеры — заглушки, поэтому здесь только каркас:
//   проверяем подпись (когда будет реализовано) и активируем подписку по
//   providerRef из ledger. Сейчас безопасно отвечаем 200, ничего не меняя.
// ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/payments/webhook/:provider
 */
export async function handleWebhook(req, res) {
  const providerName = req.params.provider;
  console.log(`💳 webhook received for provider=${providerName}`);

  // TODO(iyzico/stripe): верификация подписи + поиск транзакции по
  // providerRef + activateSubscription. Реализуем вместе с боевым адаптером,
  // когда придут ключи. До тех пор — просто подтверждаем получение, чтобы
  // провайдер не ретраил, но НИЧЕГО не активируем.
  return res.status(200).json({ received: true });
}
