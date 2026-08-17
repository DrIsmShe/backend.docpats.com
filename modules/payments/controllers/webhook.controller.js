// server/modules/payments/controllers/webhook.controller.js
// ─────────────────────────────────────────────────────────────────────
//   Приём webhook'ов от платёжных провайдеров: автоматическая активация
//   подписки после оплаты картой.
//
//   Монтируется ДО session-middleware и с express.raw: это вызов
//   сервер-серверу от шлюза, а не браузерный запрос, и подпись считается
//   по СЫРОМУ телу. Разобранный JSON обратно в те же байты не собрать —
//   порядок ключей и пробелы будут другими, подпись не сойдётся.
//
//   ТРИ ПРАВИЛА, БЕЗ КОТОРЫХ WEBHOOK ОПАСЕН:
//
//   1. Без действующей подписи не активируем НИЧЕГО. Незащищённый
//      обработчик — это кнопка «выдать себе Pro» для любого, кто узнал
//      адрес. Нет секрета в окружении → отвечаем 503, а не «ладно».
//
//   2. Идемпотентность. Провайдеры повторяют доставку при любой заминке;
//      вторая обработка того же события не должна продлевать подписку
//      второй раз. Отсюда проверка status === "paid" до активации.
//
//   3. Ошибка на нашей стороне → 500, а не 200. 200 означает «принято, не
//      повторяй», и если мы соврём, оплаченная подписка не включится
//      никогда, а провайдер об этом не узнает.
// ─────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import PaymentTransaction from "../models/paymentTransaction.js";
import User from "../../../common/models/Auth/users.js";
import { activateSubscription } from "../services/subscription.service.js";

/** Секрет проверки подписи для провайдера. */
function secretFor(provider) {
  switch (provider) {
    case "paddle":
      return process.env.PADDLE_WEBHOOK_SECRET;
    case "stripe":
      return process.env.STRIPE_WEBHOOK_SECRET;
    case "iyzico":
      return process.env.IYZICO_WEBHOOK_SECRET;
    default:
      return null;
  }
}

/**
 * Сравнение подписей за постоянное время.
 *
 * Обычное === выходит на первом несовпавшем байте, и по времени ответа
 * подпись можно подобрать. Разная длина — сразу false: timingSafeEqual на
 * буферах разной длины бросает исключение.
 */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Проверка подписи. Схемы у провайдеров разные, поэтому здесь развилка,
 * а не одна формула.
 *
 * @returns {boolean}
 */
function verifySignature(provider, req, rawBody, secret) {
  if (provider === "paddle") {
    // Paddle-Signature: ts=<unix>;h1=<hex hmac от "ts:body">
    const header = req.get("Paddle-Signature") || "";
    const parts = Object.fromEntries(
      header.split(";").map((p) => p.split("=").map((s) => s.trim())),
    );
    if (!parts.ts || !parts.h1) return false;

    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${parts.ts}:${rawBody.toString("utf8")}`)
      .digest("hex");
    return safeEqual(expected, parts.h1);
  }

  if (provider === "stripe") {
    // Stripe-Signature: t=<unix>,v1=<hex hmac от "t.body">
    const header = req.get("Stripe-Signature") || "";
    const parts = Object.fromEntries(
      header.split(",").map((p) => p.split("=").map((s) => s.trim())),
    );
    if (!parts.t || !parts.v1) return false;

    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${parts.t}.${rawBody.toString("utf8")}`)
      .digest("hex");
    return safeEqual(expected, parts.v1);
  }

  if (provider === "iyzico") {
    // iyzico подписывает тело целиком, base64 от HMAC-SHA256.
    const header = req.get("X-Iyz-Signature-V3") || "";
    const expected = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("base64");
    return safeEqual(expected, header);
  }

  return false;
}

/**
 * Достать из события ссылку на транзакцию и признак успеха.
 *
 * У каждого провайдера своя форма события; общее одно — мы кладём свой
 * идентификатор в providerRef при создании checkout и ищем по нему.
 */
function readEvent(provider, body) {
  if (provider === "paddle") {
    const okTypes = ["transaction.completed", "transaction.paid"];
    return {
      ok: okTypes.includes(body?.event_type),
      ref: body?.data?.id ?? null,
      custom: body?.data?.custom_data?.transactionId ?? null,
    };
  }
  if (provider === "stripe") {
    const okTypes = ["checkout.session.completed", "payment_intent.succeeded"];
    return {
      ok: okTypes.includes(body?.type),
      ref: body?.data?.object?.id ?? null,
      custom: body?.data?.object?.metadata?.transactionId ?? null,
    };
  }
  if (provider === "iyzico") {
    return {
      ok: body?.status === "SUCCESS" || body?.paymentStatus === "SUCCESS",
      ref: body?.token ?? body?.paymentId ?? null,
      custom: body?.conversationId ?? null,
    };
  }
  return { ok: false, ref: null, custom: null };
}

/**
 * POST /api/payments/webhook/:provider
 */
export async function handleWebhook(req, res) {
  const provider = req.params.provider;

  try {
    const secret = secretFor(provider);
    if (!secret) {
      // Секрета нет — проверить подпись нечем. Активировать вслепую
      // нельзя: это открытая кнопка «выдать подписку».
      console.warn(`webhook ${provider}: секрет не задан, событие отброшено`);
      return res
        .status(503)
        .json({ received: false, reason: "webhook secret not configured" });
    }

    // express.raw отдаёт Buffer. Если тела нет — подписывать нечего.
    const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
    if (!rawBody) {
      console.error(`webhook ${provider}: сырое тело недоступно`);
      return res.status(400).json({ received: false, reason: "raw body required" });
    }

    if (!verifySignature(provider, req, rawBody, secret)) {
      console.warn(`webhook ${provider}: подпись не сошлась`);
      return res.status(400).json({ received: false, reason: "bad signature" });
    }

    let body;
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return res.status(400).json({ received: false, reason: "bad json" });
    }

    const { ok, ref, custom } = readEvent(provider, body);
    if (!ok) {
      // Событие подлинное, но не про успешную оплату (отмена, спор,
      // обновление карты). Подтверждаем приём, чтобы не повторяли.
      return res.status(200).json({ received: true, ignored: true });
    }

    // Ищем свою транзакцию: сначала по нашему идентификатору, если
    // провайдер вернул его в метаданных, потом по своему.
    const query = custom
      ? { _id: custom }
      : { provider, providerRef: String(ref) };
    const tx = await PaymentTransaction.findOne(query);

    if (!tx) {
      // Событие подлинное, но транзакции нет: чужой аккаунт провайдера
      // или тестовое событие. Повтор ничего не изменит.
      console.warn(`webhook ${provider}: транзакция не найдена (${ref})`);
      return res.status(200).json({ received: true, unknown: true });
    }

    if (tx.status === "paid") {
      // Повторная доставка — норма, а не ошибка.
      return res.status(200).json({ received: true, alreadyPaid: true });
    }

    const user = await User.findById(tx.userId);
    if (!user) {
      console.error(`webhook ${provider}: пользователь ${tx.userId} не найден`);
      return res.status(200).json({ received: true, userMissing: true });
    }

    await activateSubscription(user, {
      planKey: tx.planKey,
      period: tx.period,
    });

    tx.status = "paid";
    tx.paidAt = new Date();
    if (ref) tx.providerRef = String(ref);
    await tx.save();

    console.log(
      `💳 webhook ${provider}: подписка ${tx.planKey} включена для ${tx.userId}`,
    );
    return res.status(200).json({ received: true, activated: true });
  } catch (err) {
    // 500, а не 200: 200 означает «принято, не повторяй». Соврав здесь,
    // мы оставим оплаченную подписку невключённой навсегда.
    console.error(`webhook ${provider} error:`, err.message);
    return res.status(500).json({ received: false });
  }
}
