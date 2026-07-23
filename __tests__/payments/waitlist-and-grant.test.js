// __tests__/payments/waitlist-and-grant.test.js
//
// Режим закрытой кассы: лист ожидания вместо оплаты, ручная выдача
// тарифа админом и состояние «касса открыта/закрыта».
//
// Всё это должно пережить запуск эквайринга: выдача останется нужной
// навсегда, а переключение кассы обязано быть переменной окружения, а
// не правкой кода.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import User from "../../common/models/Auth/users.js";
import PaymentTransaction from "../../modules/payments/models/paymentTransaction.js";
import PricingWaitlist from "../../modules/payments/models/pricingWaitlist.js";
import {
  joinWaitlist,
  listWaitlist,
} from "../../modules/payments/controllers/waitlist.controller.js";
import { grantPlanByAdmin } from "../../modules/payments/controllers/grant.controller.js";
import { isPaymentsLive } from "../../modules/payments/providers/index.js";
import { getExamQuota } from "../../modules/education/services/quota.service.js";
import { createTestDoctor } from "../helpers/createTestUser.js";

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
    send(payload) {
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

describe("состояние кассы", () => {
  const original = process.env.PAYMENTS_PROVIDER;
  afterEach(() => {
    if (original === undefined) delete process.env.PAYMENTS_PROVIDER;
    else process.env.PAYMENTS_PROVIDER = original;
  });

  it("mock — касса закрыта", () => {
    process.env.PAYMENTS_PROVIDER = "mock";
    expect(isPaymentsLive()).toBe(false);
  });

  it("боевой провайдер без ключей — тоже закрыта", () => {
    // Ключей в тестовом окружении нет, значит isConfigured() = false.
    process.env.PAYMENTS_PROVIDER = "iyzico";
    expect(isPaymentsLive()).toBe(false);
  });
});

describe("лист ожидания", () => {
  beforeEach(async () => {
    await PricingWaitlist.deleteMany({});
  });

  it("принимает заявку от гостя", async () => {
    const res = mockRes();
    await joinWaitlist(
      {
        session: {},
        body: {
          email: "Ivan@Example.COM ",
          planKey: "exam_plus",
          period: "monthly",
        },
      },
      res,
    );

    expect(res.statusCode).toBe(201);
    const saved = await PricingWaitlist.findOne({});
    // Адрес нормализуется: иначе Ivan@ и ivan@ станут двумя людьми.
    expect(saved.email).toBe("ivan@example.com");
    expect(saved.planKey).toBe("exam_plus");
    expect(saved.userId).toBeNull();
  });

  it("повторная отправка обновляет запись, а не плодит дубли", async () => {
    for (const period of ["monthly", "yearly"]) {
      await joinWaitlist(
        {
          session: {},
          body: { email: "a@b.com", planKey: "exam_plus", period },
        },
        mockRes(),
      );
    }
    expect(await PricingWaitlist.countDocuments({})).toBe(1);
    expect((await PricingWaitlist.findOne({})).period).toBe("yearly");
  });

  it("отклоняет мусор вместо email", async () => {
    const res = mockRes();
    await joinWaitlist({ session: {}, body: { email: "не-адрес" } }, res);
    expect(res.statusCode).toBe(400);
    expect(await PricingWaitlist.countDocuments({})).toBe(0);
  });

  it("неизвестный тариф не отбрасывает саму заявку", async () => {
    const res = mockRes();
    await joinWaitlist(
      { session: {}, body: { email: "c@d.com", planKey: "nope_plan" } },
      res,
    );
    expect(res.statusCode).toBe(201);
    expect((await PricingWaitlist.findOne({})).planKey).toBeNull();
  });

  it("связывает заявку с аккаунтом, если человек авторизован", async () => {
    const { userId } = await createTestPatient();
    await joinWaitlist(
      {
        session: { userId: userId.toString() },
        body: { email: "e@f.com", planKey: "patient_pro" },
      },
      mockRes(),
    );
    expect(String((await PricingWaitlist.findOne({})).userId)).toBe(
      String(userId),
    );
  });

  it("выгрузка отдаёт сводку по тарифам и CSV", async () => {
    const rows = [
      ["a@x.com", "exam_plus"],
      ["b@x.com", "exam_plus"],
      ["c@x.com", "doctor_pro"],
    ];
    for (const [email, planKey] of rows) {
      await joinWaitlist({ session: {}, body: { email, planKey } }, mockRes());
    }

    const res = mockRes();
    await listWaitlist({ query: {} }, res);
    expect(res.body.count).toBe(3);
    expect(res.body.byPlan.exam_plus).toBe(2);

    const csv = mockRes();
    await listWaitlist({ query: { format: "csv" } }, csv);
    expect(csv.headers["Content-Type"]).toContain("text/csv");
    expect(csv.body.split("\n")).toHaveLength(4); // заголовок + 3 строки
  });
});

describe("ручная выдача тарифа", () => {
  it("выдаёт план и оставляет запись в реестре", async () => {
    const { userId: adminId } = await createTestDoctor({ role: "admin" });
    const { userId } = await createTestPatient();

    const res = mockRes();
    await grantPlanByAdmin(
      {
        session: { userId: adminId.toString() },
        body: {
          userId: userId.toString(),
          planKey: "patient_pro",
          months: 3,
          reason: "оплата переводом, счёт №12",
        },
      },
      res,
    );

    expect(res.statusCode).toBe(200);
    const user = await User.findById(userId);
    expect(user.subscriptionPlan).toBe("patient_pro");

    // Срок — ровно три месяца вперёд.
    const now = new Date();
    const months =
      (user.subscriptionEndsAt.getFullYear() - now.getFullYear()) * 12 +
      (user.subscriptionEndsAt.getMonth() - now.getMonth());
    expect(months).toBe(3);

    // Главное: выдача видна в реестре и отличима от оплаты.
    const tx = await PaymentTransaction.findById(res.body.transactionId);
    expect(tx.provider).toBe("local");
    expect(tx.amount).toBe(0);
    expect(tx.status).toBe("paid");
    expect(tx.meta.manual).toBe(true);
    expect(tx.meta.reason).toContain("счёт №12");
    expect(String(tx.meta.grantedBy)).toBe(String(adminId));
  });

  it("выдаёт аддон, не трогая основной план", async () => {
    const { userId: adminId } = await createTestDoctor({ role: "admin" });
    const { userId } = await createTestPatient();

    await grantPlanByAdmin(
      {
        session: { userId: adminId.toString() },
        body: {
          userId: userId.toString(),
          planKey: "exam_unlimited",
          months: 6,
          reason: "партнёрский доступ",
        },
      },
      mockRes(),
    );

    const user = await User.findById(userId);
    expect(user.examAddon).toBe("exam_unlimited");
    expect(user.subscriptionPlan).toBeFalsy();

    // И квота модуля тестов поднялась сразу.
    expect((await getExamQuota({ userId })).unlimited).toBe(true);
  });

  it("требует причину — иначе запись нечитаема через полгода", async () => {
    const { userId: adminId } = await createTestDoctor({ role: "admin" });
    const { userId } = await createTestPatient();

    const res = mockRes();
    await grantPlanByAdmin(
      {
        session: { userId: adminId.toString() },
        body: { userId: userId.toString(), planKey: "patient_pro", months: 1 },
      },
      res,
    );
    expect(res.statusCode).toBe(400);
    expect((await User.findById(userId)).subscriptionPlan).toBeFalsy();
  });

  it("отклоняет бессмысленный срок", async () => {
    const { userId: adminId } = await createTestDoctor({ role: "admin" });
    const { userId } = await createTestPatient();

    const res = mockRes();
    await grantPlanByAdmin(
      {
        session: { userId: adminId.toString() },
        body: {
          userId: userId.toString(),
          planKey: "patient_pro",
          months: 999,
          reason: "опечатка в поле",
        },
      },
      res,
    );
    expect(res.statusCode).toBe(400);
  });
});
