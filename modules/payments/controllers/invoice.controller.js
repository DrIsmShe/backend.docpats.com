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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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
      cleanPeriod === "yearly"
        ? price.yearly * (cleanMonths / 12)
        : price.monthly * cleanMonths;

    return res.status(201).json({
      success: true,
      id: doc._id,
      planName: PLAN_DISPLAY_NAMES[planKey] || planKey,
      months: cleanMonths,
      amount: Math.round(amount * 100) / 100,
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
