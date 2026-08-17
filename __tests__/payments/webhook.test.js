// __tests__/payments/webhook.test.js
//
// Автоматическая активация подписки после оплаты картой.
//
// Обработчик webhook'а — самая опасная точка платежей: он включает
// платный тариф по запросу извне, без сессии и без CSRF. Поэтому
// проверяем не «работает ли», а «отказывает ли»: без подписи, с чужой
// подписью, при повторной доставке.

import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import mongoose from "mongoose";
import PaymentTransaction from "../../modules/payments/models/paymentTransaction.js";
import User from "../../common/models/Auth/users.js";
import { handleWebhook } from "../../modules/payments/controllers/webhook.controller.js";

const SECRET = "test-webhook-secret";

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(p) {
      this.body = p;
      return this;
    },
  };
}

/** Запрос с сырым телом и заголовками, как их шлёт Paddle. */
function paddleReq(payload, { sign = true, ts = "1700000000" } = {}) {
  const raw = Buffer.from(JSON.stringify(payload), "utf8");
  const h1 = crypto
    .createHmac("sha256", SECRET)
    .update(`${ts}:${raw.toString("utf8")}`)
    .digest("hex");

  const headers = sign
    ? { "paddle-signature": `ts=${ts};h1=${h1}` }
    : {};

  return {
    params: { provider: "paddle" },
    body: raw,
    get: (name) => headers[name.toLowerCase()] ?? "",
  };
}

let counter = 0;
async function makeDoctor() {
  counter += 1;
  const suffix = `${Date.now()}-${counter}`;
  return User.create({
    emailEncrypted: `wh-${suffix}@example.com`,
    firstNameEncrypted: "Тест",
    lastNameEncrypted: "Врач",
    emailHash: `h-${suffix}`,
    firstNameHash: "placeholder",
    lastNameHash: "placeholder",
    username: `wh_${suffix}`.replace(/[^a-z0-9_]/gi, ""),
    password: "hashed-password-placeholder",
    dateOfBirth: new Date("1980-01-01"),
    bio: "test",
    agreement: true,
    role: "doctor",
    trialEndsAt: new Date(Date.now() - 86400000),
  });
}

async function makePendingTx(userId, over = {}) {
  return PaymentTransaction.create({
    userId,
    kind: "subscription",
    planKey: "doctor_super",
    period: "monthly",
    amount: 49,
    currency: "USD",
    provider: "paddle",
    providerRef: "txn_ext_1",
    status: "pending",
    ...over,
  });
}

describe("webhook: защита", () => {
  beforeEach(() => {
    delete process.env.PADDLE_WEBHOOK_SECRET;
  });

  it("без настроенного секрета не активирует ничего", async () => {
    const doctor = await makeDoctor();
    const tx = await makePendingTx(doctor._id);
    const res = mockRes();

    await handleWebhook(
      paddleReq({ event_type: "transaction.completed", data: { id: "txn_ext_1" } }),
      res,
    );

    // 503, а не 200: проверить подпись нечем, значит активировать нельзя.
    expect(res.statusCode).toBe(503);
    expect((await PaymentTransaction.findById(tx._id)).status).toBe("pending");
  });

  it("без подписи отвергает", async () => {
    process.env.PADDLE_WEBHOOK_SECRET = SECRET;
    const doctor = await makeDoctor();
    const tx = await makePendingTx(doctor._id);
    const res = mockRes();

    await handleWebhook(
      paddleReq(
        { event_type: "transaction.completed", data: { id: "txn_ext_1" } },
        { sign: false },
      ),
      res,
    );

    expect(res.statusCode).toBe(400);
    expect((await PaymentTransaction.findById(tx._id)).status).toBe("pending");
  });

  it("с чужой подписью отвергает — иначе это кнопка «выдать себе Pro»", async () => {
    process.env.PADDLE_WEBHOOK_SECRET = "правильный-секрет";
    const doctor = await makeDoctor();
    const tx = await makePendingTx(doctor._id);
    const res = mockRes();

    // Подпись посчитана другим секретом.
    await handleWebhook(
      paddleReq({ event_type: "transaction.completed", data: { id: "txn_ext_1" } }),
      res,
    );

    expect(res.statusCode).toBe(400);
    expect((await PaymentTransaction.findById(tx._id)).status).toBe("pending");
  });
});

describe("webhook: активация", () => {
  beforeEach(() => {
    process.env.PADDLE_WEBHOOK_SECRET = SECRET;
  });

  it("подлинное событие включает подписку и закрывает транзакцию", async () => {
    const doctor = await makeDoctor();
    const tx = await makePendingTx(doctor._id);
    const res = mockRes();

    await handleWebhook(
      paddleReq({ event_type: "transaction.completed", data: { id: "txn_ext_1" } }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.activated).toBe(true);

    const fresh = await User.findById(doctor._id).lean();
    expect(fresh.subscriptionPlan).toBe("doctor_super");
    // Срок обязан быть проставлен: без него подписка не закончится никогда.
    expect(fresh.subscriptionEndsAt).toBeTruthy();

    expect((await PaymentTransaction.findById(tx._id)).status).toBe("paid");
  });

  it("повторная доставка не продлевает подписку второй раз", async () => {
    const doctor = await makeDoctor();
    await makePendingTx(doctor._id);

    const first = mockRes();
    await handleWebhook(
      paddleReq({ event_type: "transaction.completed", data: { id: "txn_ext_1" } }),
      first,
    );
    const after = await User.findById(doctor._id).lean();

    const second = mockRes();
    await handleWebhook(
      paddleReq({ event_type: "transaction.completed", data: { id: "txn_ext_1" } }),
      second,
    );

    expect(second.body.alreadyPaid).toBe(true);
    const again = await User.findById(doctor._id).lean();
    expect(again.subscriptionEndsAt.getTime()).toBe(
      after.subscriptionEndsAt.getTime(),
    );
  });

  it("событие не про оплату подтверждается, но ничего не меняет", async () => {
    const doctor = await makeDoctor();
    const tx = await makePendingTx(doctor._id);
    const res = mockRes();

    await handleWebhook(
      paddleReq({ event_type: "transaction.canceled", data: { id: "txn_ext_1" } }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.ignored).toBe(true);
    expect((await PaymentTransaction.findById(tx._id)).status).toBe("pending");
  });

  it("неизвестная транзакция не повод для повторов", async () => {
    const res = mockRes();
    await handleWebhook(
      paddleReq({ event_type: "transaction.completed", data: { id: "чужая" } }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.unknown).toBe(true);
  });

  it("идентификатор из метаданных важнее внешнего", async () => {
    const doctor = await makeDoctor();
    const tx = await makePendingTx(doctor._id, { providerRef: null });
    const res = mockRes();

    await handleWebhook(
      paddleReq({
        event_type: "transaction.completed",
        data: { id: "txn_ext_9", custom_data: { transactionId: String(tx._id) } },
      }),
      res,
    );

    expect(res.body.activated).toBe(true);
    const fresh = await PaymentTransaction.findById(tx._id);
    expect(fresh.status).toBe("paid");
    expect(fresh.providerRef).toBe("txn_ext_9");
  });
});
