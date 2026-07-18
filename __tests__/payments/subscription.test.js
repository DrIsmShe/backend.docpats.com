// __tests__/payments/subscription.test.js
//
// Поток подписки на mock-провайдере: checkout → подтверждение → план
// активирован на модели User. Проверяет валидацию плана под роль,
// расчёт даты окончания и запись в ledger.

import { describe, it, expect, beforeAll } from "vitest";
import mongoose from "mongoose";
import User from "../../common/models/Auth/users.js";
import PaymentTransaction from "../../modules/payments/models/paymentTransaction.js";
import {
  createSubscriptionCheckout,
  confirmMockPayment,
} from "../../modules/payments/controllers/checkout.controller.js";
import {
  assertPlanAllowed,
  getPlanAmountAZN,
  computeSubscriptionEnd,
} from "../../modules/payments/services/subscription.service.js";
import { createTestDoctor } from "../helpers/createTestUser.js";

// Гарантируем mock-провайдер (без реальных ключей/списаний).
beforeAll(() => {
  process.env.PAYMENTS_PROVIDER = "mock";
});

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function createTestPatient(overrides = {}) {
  return createTestDoctor({
    role: "patient",
    isDoctor: false,
    isPatient: true,
    ...overrides,
  });
}

describe("subscription.service — валидация и расчёты", () => {
  it("assertPlanAllowed пропускает план врача для доктора", () => {
    expect(() =>
      assertPlanAllowed("doctor_super", "monthly", "doctor"),
    ).not.toThrow();
  });

  it("assertPlanAllowed запрещает пациентский план доктору", () => {
    expect(() =>
      assertPlanAllowed("patient_pro", "monthly", "doctor"),
    ).toThrow();
  });

  it("assertPlanAllowed запрещает несуществующий план", () => {
    expect(() => assertPlanAllowed("nope", "monthly", "doctor")).toThrow();
  });

  it("getPlanAmountAZN возвращает цену из aiPlanLimits", () => {
    expect(getPlanAmountAZN("doctor_super", "monthly")).toBe(23);
    expect(getPlanAmountAZN("doctor_super", "yearly")).toBe(220);
  });

  it("computeSubscriptionEnd продлевает от будущей даты (стекинг)", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const future = new Date("2026-06-01T00:00:00Z");
    const end = computeSubscriptionEnd("monthly", future, now);
    // от 2026-06-01 + 1 месяц = 2026-07-01
    expect(end.getUTCMonth()).toBe(6); // июль (0-индекс)
  });
});

describe("checkout flow (mock provider)", () => {
  it("checkout создаёт pending-транзакцию и возвращает checkoutUrl", async () => {
    const { userId } = await createTestDoctor();
    const req = {
      session: { userId: userId.toString() },
      body: { planKey: "doctor_super", period: "monthly" },
    };
    const res = mockRes();
    await createSubscriptionCheckout(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.provider).toBe("mock");
    expect(res.body.amount).toBe(23);
    expect(res.body.checkoutUrl).toContain("/payment/mock");
    expect(res.body.transactionId).toBeTruthy();

    const tx = await PaymentTransaction.findById(res.body.transactionId);
    expect(tx.status).toBe("pending");
    expect(tx.planKey).toBe("doctor_super");
  });

  it("mock/confirm активирует подписку на User и помечает tx paid", async () => {
    const { userId } = await createTestDoctor();
    const req = {
      session: { userId: userId.toString() },
      body: { planKey: "doctor_pro", period: "yearly" },
    };
    const res = mockRes();
    await createSubscriptionCheckout(req, res);
    const transactionId = res.body.transactionId;

    const res2 = mockRes();
    await confirmMockPayment(
      { session: { userId: userId.toString() }, body: { transactionId } },
      res2,
    );

    expect(res2.statusCode).toBe(200);
    expect(res2.body.success).toBe(true);
    expect(res2.body.subscription.subscriptionPlan).toBe("doctor_pro");

    const user = await User.findById(userId);
    expect(user.subscriptionPlan).toBe("doctor_pro");
    expect(user.subscriptionPeriod).toBe("yearly");
    expect(user.subscriptionEndsAt).toBeTruthy();
    expect(user.paymentLastChargedAt).toBeTruthy();

    const tx = await PaymentTransaction.findById(transactionId);
    expect(tx.status).toBe("paid");
    expect(tx.paidAt).toBeTruthy();
  });

  it("повторный confirm возвращает alreadyPaid без двойной активации", async () => {
    const { userId } = await createTestDoctor();
    const res = mockRes();
    await createSubscriptionCheckout(
      {
        session: { userId: userId.toString() },
        body: { planKey: "doctor_basic", period: "monthly" },
      },
      res,
    );
    const transactionId = res.body.transactionId;
    const uid = { session: { userId: userId.toString() }, body: { transactionId } };

    const r1 = mockRes();
    await confirmMockPayment(uid, r1);
    expect(r1.body.success).toBe(true);

    const r2 = mockRes();
    await confirmMockPayment(uid, r2);
    expect(r2.body.alreadyPaid).toBe(true);
  });

  it("checkout отклоняет пациентский план для доктора (400)", async () => {
    const { userId } = await createTestDoctor();
    const res = mockRes();
    await createSubscriptionCheckout(
      {
        session: { userId: userId.toString() },
        body: { planKey: "patient_pro", period: "monthly" },
      },
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("пациент может купить пациентский план", async () => {
    const { userId } = await createTestPatient();
    const res = mockRes();
    await createSubscriptionCheckout(
      {
        session: { userId: userId.toString() },
        body: { planKey: "patient_std", period: "monthly" },
      },
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.amount).toBe(9); // patient_std monthly AZN
  });

  it("нельзя подтвердить чужую транзакцию", async () => {
    const a = await createTestDoctor();
    const b = await createTestDoctor();
    const res = mockRes();
    await createSubscriptionCheckout(
      {
        session: { userId: a.userId.toString() },
        body: { planKey: "doctor_basic", period: "monthly" },
      },
      res,
    );
    const transactionId = res.body.transactionId;

    const res2 = mockRes();
    await confirmMockPayment(
      { session: { userId: b.userId.toString() }, body: { transactionId } },
      res2,
    );
    expect(res2.statusCode).toBe(404); // не найдено под чужим userId
  });
});
