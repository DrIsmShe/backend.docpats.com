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
  getPlanAmount,
  computeSubscriptionEnd,
} from "../../modules/payments/services/subscription.service.js";
import { createTestDoctor } from "../helpers/createTestUser.js";
import { getExamQuota } from "../../modules/education/services/quota.service.js";

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

  it("getPlanAmount возвращает цену USD из aiPlanLimits", () => {
    expect(getPlanAmount("doctor_super", "monthly")).toBe(49);
    expect(getPlanAmount("doctor_super", "yearly")).toBe(490);
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
    expect(res.body.amount).toBe(49);
    expect(res.body.currency).toBe("USD");
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

// ═══════════════════════════════════════════════════════════════════
//   Аддон «Подготовка к экзаменам»
//
//   Отдельная ось поверх плана: покупается тем же checkout-потоком, но
//   кладётся в examAddon и НЕ трогает subscriptionPlan. Иначе покупка
//   тестов сбрасывала бы человека с оплаченного тарифа.
// ═══════════════════════════════════════════════════════════════════
describe("аддон Exam Prep", () => {
  it("покупать может любая роль — это не врачебный инструмент", () => {
    expect(() =>
      assertPlanAllowed("exam_plus", "monthly", "patient"),
    ).not.toThrow();
    expect(() =>
      assertPlanAllowed("exam_unlimited", "yearly", "doctor"),
    ).not.toThrow();
  });

  it("цена берётся из EXAM_ADDON_PRICES", () => {
    expect(getPlanAmount("exam_plus", "monthly")).toBe(7);
    expect(getPlanAmount("exam_plus", "yearly")).toBe(70);
    expect(getPlanAmount("exam_unlimited", "monthly")).toBe(15);
  });

  it("покупка не сбрасывает основной план", async () => {
    const { userId } = await createTestPatient();

    // Сначала обычная подписка.
    const res1 = mockRes();
    await createSubscriptionCheckout(
      {
        session: { userId: userId.toString() },
        body: { planKey: "patient_std", period: "monthly" },
      },
      res1,
    );
    const res2 = mockRes();
    await confirmMockPayment(
      {
        session: { userId: userId.toString() },
        body: { transactionId: res1.body.transactionId },
      },
      res2,
    );
    expect((await User.findById(userId)).subscriptionPlan).toBe("patient_std");

    // Теперь аддон поверх неё.
    const res3 = mockRes();
    await createSubscriptionCheckout(
      {
        session: { userId: userId.toString() },
        body: { planKey: "exam_plus", period: "monthly" },
      },
      res3,
    );
    expect(res3.body.amount).toBe(7);

    const res4 = mockRes();
    await confirmMockPayment(
      {
        session: { userId: userId.toString() },
        body: { transactionId: res3.body.transactionId },
      },
      res4,
    );

    const user = await User.findById(userId);
    expect(user.examAddon).toBe("exam_plus");
    expect(user.examAddonEndsAt).toBeInstanceOf(Date);
    // Главное: план остался прежним.
    expect(user.subscriptionPlan).toBe("patient_std");
  });

  it("квота модуля тестов поднимается сразу после покупки", async () => {
    const { userId } = await createTestPatient();
    const before = await getExamQuota({ userId });
    expect(before.limit).toBe(250);

    const res1 = mockRes();
    await createSubscriptionCheckout(
      {
        session: { userId: userId.toString() },
        body: { planKey: "exam_unlimited", period: "monthly" },
      },
      res1,
    );
    await confirmMockPayment(
      {
        session: { userId: userId.toString() },
        body: { transactionId: res1.body.transactionId },
      },
      mockRes(),
    );

    const after = await getExamQuota({ userId });
    expect(after.unlimited).toBe(true);
    expect(after.addonLabel).toBe("Exam Prep Unlimited");
  });
});
