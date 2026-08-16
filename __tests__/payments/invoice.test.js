// __tests__/payments/invoice.test.js
//
// Оплата по счёту — параллельный канал к онлайн-оплате.
//
// Проверяем не форму, а сквозной путь: заявка → подтверждение оплаты →
// выданный тариф → запись в реестре транзакций. Разойдись этот путь с
// онлайн-оплатой, и в базе появятся подписки, происхождение которых
// через полгода никто не восстановит.

import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

// Почту подменяем: тесты не должны стучаться в Brevo, а нам нужно
// проверить, что письма вообще отправляются и кому.
const sent = [];
vi.mock("../../modules/auth/services/emailService.js", () => ({
  sendEmail: vi.fn(async (to, subject, text) => {
    sent.push({ to, subject, text });
    return { messageId: "test" };
  }),
}));

const { sendEmail } = await import("../../modules/auth/services/emailService.js");
import User from "../../common/models/Auth/users.js";
import PaymentTransaction from "../../modules/payments/models/paymentTransaction.js";
import InvoiceRequest from "../../modules/payments/models/invoiceRequest.js";
import {
  createInvoiceRequest,
  listInvoiceRequests,
  markInvoicePaid,
  deleteInvoiceRequest,
} from "../../modules/payments/controllers/invoice.controller.js";
import { createTestDoctor } from "../helpers/createTestUser.js";

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

const validBody = (over = {}) => ({
  email: "buh@clinic.example",
  companyName: "Клиника Здоровье",
  contactName: "Бухгалтер",
  taxId: "1234567890",
  country: "AZ",
  planKey: "clinic_start",
  period: "yearly",
  months: 12,
  ...over,
});

describe("заявка на счёт", () => {
  beforeEach(() => {
    sent.length = 0;
    sendEmail.mockClear();
  });

  it("уведомляет обе стороны: заявителя и того, кто выпишет счёт", async () => {
    const res = mockRes();
    await createInvoiceRequest({ body: validBody(), session: {} }, res);
    expect(res.statusCode).toBe(201);

    // Письма уходят фоном — дать промисам разрешиться.
    await new Promise((r) => setImmediate(r));

    expect(sent).toHaveLength(2);

    const toClient = sent.find((m) => m.to === "buh@clinic.example");
    expect(toClient).toBeTruthy();
    expect(toClient.text).toContain("990");
    expect(toClient.text).toContain("Clinic Start");

    // Заявка, о которой никто не узнал, эквивалентна неотправленной.
    const toUs = sent.find((m) => m.to !== "buh@clinic.example");
    expect(toUs).toBeTruthy();
    expect(toUs.text).toContain("Клиника Здоровье");
    expect(toUs.text).toContain("1234567890"); // налоговый номер — без него счёт не выписать
  });

  it("недоступный SMTP не теряет заявку", async () => {
    sendEmail.mockRejectedValueOnce(new Error("SMTP down"));
    sendEmail.mockRejectedValueOnce(new Error("SMTP down"));

    const res = mockRes();
    await createInvoiceRequest({ body: validBody(), session: {} }, res);
    await new Promise((r) => setImmediate(r));

    // Заявка сохранена, ответ успешный: потерять её из-за письма — худший
    // исход, клиент считает что попросил счёт, а в базе пусто.
    expect(res.statusCode).toBe(201);
    expect(await InvoiceRequest.countDocuments()).toBe(1);
  });

  it("принимается без авторизации: счёт просит бухгалтер, а не пользователь", async () => {
    const res = mockRes();
    await createInvoiceRequest({ body: validBody(), session: {} }, res);

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    // Сумма считается из справочника, чтобы заявитель сразу видел цифру.
    expect(res.body.amount).toBe(990);
    expect(res.body.planName).toBe("Clinic Start");

    const saved = await InvoiceRequest.findById(res.body.id).lean();
    expect(saved.status).toBe("new");
    expect(saved.userId).toBeNull();
  });

  it("несуществующий тариф отклоняется, заявка не создаётся", async () => {
    const res = mockRes();
    await createInvoiceRequest(
      { body: validBody({ planKey: "clinic_galactic" }), session: {} },
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(await InvoiceRequest.countDocuments()).toBe(0);
  });

  it("без названия организации счёт выписать нельзя", async () => {
    const res = mockRes();
    await createInvoiceRequest(
      { body: validBody({ companyName: " " }), session: {} },
      res,
    );
    expect(res.statusCode).toBe(400);
  });

  it("битый email отклоняется", async () => {
    const res = mockRes();
    await createInvoiceRequest(
      { body: validBody({ email: "не-адрес" }), session: {} },
      res,
    );
    expect(res.statusCode).toBe(400);
  });
});

describe("подтверждение оплаты по счёту", () => {
  let doctor;

  beforeEach(async () => {
    // Помощник возвращает { user, userId }, а не сам документ.
    ({ user: doctor } = await createTestDoctor());
  });

  async function makeRequest(over = {}) {
    const res = mockRes();
    await createInvoiceRequest(
      { body: validBody({ planKey: "doctor_super", ...over }), session: {} },
      res,
    );
    return res.body.id;
  }

  it("выдаёт тариф и пишет транзакцию с provider=invoice", async () => {
    const id = await makeRequest();
    const res = mockRes();

    await markInvoicePaid(
      {
        params: { id },
        body: { userId: String(doctor._id), invoiceNumber: "INV-2026-001" },
        session: { userId: String(doctor._id) },
      },
      res,
    );

    expect(res.statusCode).toBe(200);

    const fresh = await User.findById(doctor._id).lean();
    expect(fresh.subscriptionPlan).toBe("doctor_super");

    const tx = await PaymentTransaction.findById(res.body.transactionId).lean();
    // provider отличает выручку по счёту от бесплатной ручной выдачи
    // (provider: "local") — в отчёте они не должны смешиваться.
    expect(tx.provider).toBe("invoice");
    expect(tx.status).toBe("paid");
    expect(tx.amount).toBe(490);
    expect(tx.providerRef).toBe("INV-2026-001");

    // Клиент должен узнать, что тариф включён, не заходя в кабинет.
    await new Promise((r) => setImmediate(r));
    const activation = sent.find((m) => /подключён/.test(m.subject));
    expect(activation).toBeTruthy();
    expect(activation.to).toBe("buh@clinic.example");
    expect(activation.text).toContain("INV-2026-001");

    const request = await InvoiceRequest.findById(id).lean();
    expect(request.status).toBe("paid");
    expect(request.transactionId.toString()).toBe(tx._id.toString());
    // Выдача мимо эквайринга должна быть именной.
    expect(request.processedBy.toString()).toBe(doctor._id.toString());
  });

  it("повторное подтверждение отклоняется — тариф не удваивается", async () => {
    const id = await makeRequest();
    const first = mockRes();
    await markInvoicePaid(
      {
        params: { id },
        body: { userId: String(doctor._id) },
        session: { userId: String(doctor._id) },
      },
      first,
    );
    expect(first.statusCode).toBe(200);

    const second = mockRes();
    await markInvoicePaid(
      {
        params: { id },
        body: { userId: String(doctor._id) },
        session: { userId: String(doctor._id) },
      },
      second,
    );

    expect(second.statusCode).toBe(409);
    expect(await PaymentTransaction.countDocuments()).toBe(1);
  });

  it("без получателя не выдаёт: в заявке аккаунт мог быть не привязан", async () => {
    const id = await makeRequest();
    const res = mockRes();

    await markInvoicePaid(
      { params: { id }, body: {}, session: { userId: String(doctor._id) } },
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(await PaymentTransaction.countDocuments()).toBe(0);
  });

  it("фактическая сумма перебивает прайс: банк зачисляет с курсом и комиссией", async () => {
    const id = await makeRequest();
    const res = mockRes();

    await markInvoicePaid(
      {
        params: { id },
        body: { userId: String(doctor._id), amount: 478.35 },
        session: { userId: String(doctor._id) },
      },
      res,
    );

    const tx = await PaymentTransaction.findById(res.body.transactionId).lean();
    expect(tx.amount).toBe(478.35);
  });

  it("неоплаченную заявку можно удалить: проверочные и дубли не должны копиться", async () => {
    const id = await makeRequest();
    const res = mockRes();

    await deleteInvoiceRequest(
      { params: { id }, session: { userId: String(doctor._id) } },
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(await InvoiceRequest.countDocuments()).toBe(0);
  });

  it("оплаченную удалить нельзя — на ней транзакция", async () => {
    const id = await makeRequest();
    await markInvoicePaid(
      {
        params: { id },
        body: { userId: String(doctor._id) },
        session: { userId: String(doctor._id) },
      },
      mockRes(),
    );

    const res = mockRes();
    await deleteInvoiceRequest(
      { params: { id }, session: { userId: String(doctor._id) } },
      res,
    );

    // Удалив заявку, мы оставили бы в реестре деньги, происхождение
    // которых уже не восстановить.
    expect(res.statusCode).toBe(409);
    expect(await InvoiceRequest.countDocuments()).toBe(1);
    expect(await PaymentTransaction.countDocuments()).toBe(1);
  });

  it("список фильтруется по статусу — иначе он свалка, а не инструмент", async () => {
    const paidId = await makeRequest();
    await makeRequest({ email: "second@clinic.example" });

    await markInvoicePaid(
      {
        params: { id: paidId },
        body: { userId: String(doctor._id) },
        session: { userId: String(doctor._id) },
      },
      mockRes(),
    );

    const res = mockRes();
    await listInvoiceRequests({ query: { status: "new" } }, res);

    expect(res.body.count).toBe(1);
    expect(res.body.items[0].status).toBe("new");
  });
});
