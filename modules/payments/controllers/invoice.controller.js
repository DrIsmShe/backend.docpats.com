// server/modules/payments/controllers/invoice.controller.js
// ─────────────────────────────────────────────────────────────────────
//   Оплата по счёту — параллельный канал к онлайн-оплате.
//
//   Три действия: оставить заявку (кто угодно), посмотреть список
//   (администратор), подтвердить оплату (администратор).
//
//   Подтверждение оплаты ОБЯЗАНО проходить тем же путём, что и
//   онлайн-платёж: grantPlan + запись в реестр транзакций. Разойдись эти
//   два пути — и в базе появятся подписки, происхождение которых через
//   полгода никто не восстановит.
// ─────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";
import InvoiceRequest from "../models/invoiceRequest.js";
import PaymentTransaction from "../models/paymentTransaction.js";
import User from "../../../common/models/Auth/users.js";
import { grantPlan } from "../services/subscription.service.js";
import {
  PLAN_PRICES,
  PLAN_DISPLAY_NAMES,
} from "../../../common/config/aiPlanLimits.js";
// Берём сервис из auth, а не из admin: в admin/emailService from задан
// как SMTP_USER — это логин Brevo, а не адрес, и письма с ним молча не
// доходят. Здесь from резолвится в проверенный отправитель.
import { sendEmail } from "../../auth/services/emailService.js";
import { requisitesAsText } from "./requisites.controller.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Куда падают заявки. Отдельная переменная, потому что счета обычно
// смотрит не тот, кто отвечает на обращения в поддержку.
const BILLING_INBOX =
  process.env.BILLING_EMAIL || process.env.SUPPORT_EMAIL || "support@docpats.com";

/**
 * Письмо, которое НЕ должно ломать заявку.
 *
 * Заявка к этому моменту уже сохранена. Если SMTP недоступен, потерять
 * её из-за письма — худший исход: клиент считает, что попросил счёт, а в
 * базе пусто. Поэтому ошибка только пишется в лог.
 */
function sendSafe(to, subject, text) {
  return sendEmail(to, subject, text).catch((e) => {
    console.error(`invoice: письмо на ${to} не ушло — ${e.message}`);
  });
}

/** Человеческое описание заявки — общая часть обоих писем. */
function describe(doc, planName, amount) {
  const period = doc.period === "yearly" ? "год" : "месяц";
  return [
    `Тариф: ${planName}`,
    `Период: ${period}, ${doc.months} мес.`,
    `Сумма: ${amount} USD`,
  ].join("\n");
}

/**
 * POST /api/payments/invoice-request
 *
 * Открыт без авторизации намеренно: счёт просит бухгалтер или
 * администратор клиники, у которого аккаунта на платформе нет и не
 * будет. Требовать от него регистрации — терять самого дорогого клиента
 * на первом шаге.
 */
export async function createInvoiceRequest(req, res) {
  try {
    const {
      email,
      companyName,
      contactName,
      phone,
      taxId,
      country,
      planKey,
      period,
      months,
      note,
    } = req.body || {};

    const cleanEmail = String(email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(cleanEmail)) {
      return res
        .status(400)
        .json({ success: false, message: "Укажите корректный email" });
    }

    const cleanCompany = String(companyName ?? "").trim();
    if (cleanCompany.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Укажите название организации или своё имя",
      });
    }

    // Тариф сверяем со справочником: счёт на несуществующий план — это
    // либо опечатка, либо подбор, и в обоих случаях создавать заявку
    // незачем.
    if (!PLAN_PRICES[planKey]) {
      return res
        .status(400)
        .json({ success: false, message: "Неизвестный тариф" });
    }

    const cleanPeriod = period === "monthly" ? "monthly" : "yearly";
    let cleanMonths = Number.parseInt(months, 10);
    if (!Number.isInteger(cleanMonths) || cleanMonths < 1 || cleanMonths > 36) {
      cleanMonths = cleanPeriod === "yearly" ? 12 : 1;
    }

    const doc = await InvoiceRequest.create({
      email: cleanEmail,
      companyName: cleanCompany,
      contactName: String(contactName ?? "").trim().slice(0, 200),
      phone: String(phone ?? "").trim().slice(0, 40),
      taxId: String(taxId ?? "").trim().slice(0, 50),
      country: String(country ?? "").trim().slice(0, 80),
      planKey,
      period: cleanPeriod,
      months: cleanMonths,
      note: String(note ?? "").trim().slice(0, 1000),
      userId: req.session?.userId || null,
    });

    // Сумму считаем и возвращаем, чтобы заявитель сразу видел, о какой
    // цифре речь, и мог сверить со счётом.
    const price = PLAN_PRICES[planKey];
    const amount =
      Math.round(
        (cleanPeriod === "yearly"
          ? price.yearly * (cleanMonths / 12)
          : price.monthly * cleanMonths) * 100,
      ) / 100;
    const planName = PLAN_DISPLAY_NAMES[planKey] || planKey;

    // Два письма, и оба обязательны.
    //
    // Заявителю — потому что ответ на экране исчезает вместе со вкладкой,
    // а обещание «счёт придёт» остаётся. Без письма человек через день не
    // помнит, отправил он форму или передумал.
    //
    // Нам — потому что счёт выписывает человек. Заявка, о которой никто не
    // узнал, эквивалентна неотправленной: ровно то, чем эта форма была до
    // сих пор.
    // Реквизиты кладём сразу в подтверждение, а не ждём выставленного
    // счёта: платить хотят в тот же час, пока решение принято. Счёт как
    // документ нужен бухгалтерии, но деньги можно отправить раньше.
    //
    // Список берётся из справочника, которым администратор управляет сам:
    // банк закрыл счёт, добавили карту в другой валюте — правится в
    // админке, без рестарта сервера.
    const requisites = await requisitesAsText().catch(() => "");

    sendSafe(
      doc.email,
      `DocPats — счёт на ${planName}`,
      [
        `Здравствуйте!`,
        ``,
        `Мы получили заявку на счёт от «${cleanCompany}».`,
        ``,
        describe(doc, planName, amount),
        ``,
        // Заголовок «Реквизиты для оплаты» уже внутри блока: там он
        // зависит от того, один способ или несколько.
        ...(requisites
          ? [
              requisites,
              ``,
              `После поступления средств тариф подключается в течение`,
              `рабочего дня — вы получите отдельное письмо.`,
              ``,
            ]
          : [`Счёт и реквизиты придут на этот адрес в течение рабочего дня.`, ``]),
        `Если заявку оставили по ошибке — просто ответьте на это письмо.`,
        ``,
        `— DocPats`,
      ].join("\n"),
    );

    sendSafe(
      BILLING_INBOX,
      `Заявка на счёт: ${cleanCompany} — ${planName}`,
      [
        `Организация: ${cleanCompany}`,
        `Контакт: ${String(contactName ?? "").trim() || "—"}`,
        `Email: ${doc.email}`,
        `Телефон: ${doc.phone || "—"}`,
        `Налоговый номер: ${doc.taxId || "—"}`,
        `Страна: ${doc.country || "—"}`,
        ``,
        describe(doc, planName, amount),
        ``,
        doc.note ? `Комментарий: ${doc.note}` : "",
        `Аккаунт на платформе: ${doc.userId ? String(doc.userId) : "не привязан"}`,
        `Идентификатор заявки: ${doc._id}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );

    return res.status(201).json({
      success: true,
      id: doc._id,
      planName,
      months: cleanMonths,
      amount,
      currency: "USD",
      message:
        "Заявка принята. Счёт придёт на указанный email в течение рабочего дня.",
    });
  } catch (err) {
    console.error("createInvoiceRequest error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

/** GET /api/payments/invoice-requests?status=new — список для администратора. */
export async function listInvoiceRequests(req, res) {
  try {
    const filter = {};
    const { status } = req.query || {};
    if (status && status !== "all") filter.status = status;

    const items = await InvoiceRequest.find(filter)
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    return res.status(200).json({ success: true, count: items.length, items });
  } catch (err) {
    console.error("listInvoiceRequests error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * DELETE /api/payments/invoice-requests/:id
 *
 * Убрать заявку из списка: проверочная, дубль, передумали. Без этого
 * список зарастает и перестаёт быть рабочим инструментом — а именно
 * рабочим он и должен быть, счета выписывает человек по нему.
 *
 * ОПЛАЧЕННЫЕ НЕ УДАЛЯЮТСЯ. На них висит транзакция; удалив заявку, мы
 * оставим в реестре деньги, происхождение которых уже не восстановить.
 * Такую заявку можно только пометить отменённой — но и это не отменяет
 * платежа, поэтому решение остаётся за человеком.
 */
export async function deleteInvoiceRequest(req, res) {
  try {
    const request = await InvoiceRequest.findById(req.params.id);
    if (!request) {
      return res
        .status(404)
        .json({ success: false, message: "Заявка не найдена" });
    }

    if (request.status === "paid") {
      return res.status(409).json({
        success: false,
        message:
          "Заявка оплачена: на ней транзакция, удаление разорвало бы связь с деньгами",
        transactionId: request.transactionId,
      });
    }

    await request.deleteOne();
    console.log(
      `invoice: заявка ${request._id} (${request.companyName}) удалена админом ${req.session.userId}`,
    );

    return res.status(200).json({ success: true, id: String(request._id) });
  } catch (err) {
    console.error("deleteInvoiceRequest error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * POST /api/payments/invoice-requests/:id/paid
 * { userId?, invoiceNumber?, amount? }
 *
 * Администратор увидел поступление на счёт и подтверждает оплату.
 * Тариф выдаётся тому пользователю, что указан в заявке, либо тому,
 * кого передали явно (аккаунт мог быть заведён уже после заявки).
 */
export async function markInvoicePaid(req, res) {
  try {
    const request = await InvoiceRequest.findById(req.params.id);
    if (!request) {
      return res
        .status(404)
        .json({ success: false, message: "Заявка не найдена" });
    }
    if (request.status === "paid") {
      return res
        .status(409)
        .json({ success: false, message: "Заявка уже оплачена" });
    }

    const targetId = req.body?.userId || request.userId;
    if (!targetId || !mongoose.isValidObjectId(targetId)) {
      return res.status(400).json({
        success: false,
        message:
          "Укажите userId, кому выдать тариф: в заявке аккаунт не привязан",
      });
    }

    const user = await User.findById(targetId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "Пользователь не найден" });
    }

    let result;
    try {
      result = await grantPlan(user, {
        planKey: request.planKey,
        months: request.months,
      });
    } catch (e) {
      return res.status(400).json({ success: false, message: e.message });
    }

    // Сумма из тела запроса, если банк зачислил не ровно прайс (курс,
    // комиссия банка, договорная скидка). Иначе считаем по справочнику.
    const price = PLAN_PRICES[request.planKey];
    const listAmount =
      request.period === "yearly"
        ? price.yearly * (request.months / 12)
        : price.monthly * request.months;
    const amount = Number.isFinite(Number(req.body?.amount))
      ? Number(req.body.amount)
      : Math.round(listAmount * 100) / 100;

    // Номер счёта проставляем ДО создания транзакции: именно он попадает
    // в providerRef и по нему потом сверяют с банковской выпиской.
    // Иначе в реестр уходил идентификатор заявки, а номер, который
    // администратор ввёл при подтверждении, терялся.
    if (req.body?.invoiceNumber) {
      request.invoiceNumber = String(req.body.invoiceNumber).trim().slice(0, 60);
    }

    const tx = await PaymentTransaction.create({
      userId: user._id,
      kind: "subscription",
      planKey: request.planKey,
      period: request.period,
      amount,
      currency: "USD",
      provider: "invoice",
      providerRef: request.invoiceNumber || String(request._id),
      status: "paid",
      paidAt: new Date(),
      meta: {
        invoiceRequestId: String(request._id),
        months: request.months,
        companyName: request.companyName,
        confirmedBy: String(req.session.userId),
      },
    });

    request.status = "paid";
    request.paidAt = new Date();
    request.processedBy = req.session.userId;
    request.transactionId = tx._id;
    await request.save();

    // Клиент заплатил и ждёт подтверждения. Без письма он узнает, что
    // тариф включён, только зайдя в кабинет и заметив разницу.
    const planName = PLAN_DISPLAY_NAMES[request.planKey] || request.planKey;
    sendSafe(
      request.email,
      `DocPats — тариф ${planName} подключён`,
      [
        `Здравствуйте!`,
        ``,
        `Оплата получена, тариф подключён.`,
        ``,
        `Тариф: ${planName}`,
        `Оплачено месяцев: ${request.months}`,
        `Сумма: ${amount} USD`,
        request.invoiceNumber ? `Счёт: ${request.invoiceNumber}` : "",
        ``,
        `— DocPats`,
      ]
        .filter(Boolean)
        .join("\n"),
    );

    return res.status(200).json({
      success: true,
      transactionId: tx._id,
      userId: String(user._id),
      planKey: request.planKey,
      months: request.months,
      amount,
      ...result,
    });
  } catch (err) {
    console.error("markInvoicePaid error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}
