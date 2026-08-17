// server/modules/payments/payments.routes.js
// ─────────────────────────────────────────────────────────────────────
//   Роуты платежей (после session-middleware).
//   Монтируется: app.use("/api/payments", paymentsRouter)
// ─────────────────────────────────────────────────────────────────────

import express from "express";
import User from "../../common/models/Auth/users.js";
import { getPlans, getMySubscription } from "./controllers/pricing.controller.js";
import {
  createSubscriptionCheckout,
  confirmMockPayment,
} from "./controllers/checkout.controller.js";
import {
  joinWaitlist,
  listWaitlist,
} from "./controllers/waitlist.controller.js";
import { grantPlanByAdmin } from "./controllers/grant.controller.js";
import {
  createInvoiceRequest,
  listInvoiceRequests,
  markInvoicePaid,
  archiveInvoiceRequest,
  restoreInvoiceRequest,
  deleteInvoiceRequest,
  claimInvoicePayment,
} from "./controllers/invoice.controller.js";
import {
  listRequisites,
  createRequisite,
  updateRequisite,
  deactivateRequisite,
} from "./controllers/requisites.controller.js";

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res
      .status(401)
      .json({ success: false, message: "Not authenticated" });
  }
  next();
}

async function requireAdmin(req, res, next) {
  try {
    const user = await User.findById(req.session.userId).select("role").lean();
    if (user?.role !== "admin") {
      return res
        .status(403)
        .json({ success: false, message: "Admin only" });
    }
    next();
  } catch {
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * Тестовое подтверждение оплаты — только вне продакшена или админом.
 *
 * До этой проверки любой зарегистрированный пользователь мог выдать себе
 * платный тариф: mock-провайдер активирует подписку по факту нажатия
 * кнопки, без каких-либо денег. Пока касса закрыта, это не потеря
 * выручки, но это «оплаченные» подписки, которых никто не оплачивал —
 * потом их не отличить от настоящих.
 */
async function requireMockConfirmAllowed(req, res, next) {
  if (process.env.NODE_ENV !== "production") return next();
  return requireAdmin(req, res, next);
}

// Публичный прайс-лист (для страницы тарифов).
router.get("/plans", getPlans);

// Текущая подписка юзера.
router.get("/my-subscription", requireAuth, getMySubscription);

// Начать оплату подписки.
router.post("/subscribe", requireAuth, createSubscriptionCheckout);

// Подтверждение оплаты для ТЕСТОВОГО (mock) провайдера.
router.post(
  "/mock/confirm",
  requireAuth,
  requireMockConfirmAllowed,
  confirmMockPayment,
);

// ─── Лист ожидания (пока касса закрыта) ───────────────────────────────
// Открыт без авторизации: интерес к тарифу может оставить и гость,
// который ещё не завёл аккаунт — именно он и есть будущий покупатель.
router.post("/waitlist", joinWaitlist);
router.get("/waitlist", requireAuth, requireAdmin, listWaitlist);

// ─── Оплата по счёту ──────────────────────────────────────────────────
//
// ПАРАЛЛЕЛЬНЫЙ канал к онлайн-оплате, а не замена ей: бухгалтерия клиники
// не платит корпоративной картой, и для чека в 99–499 $ счёт с
// закрывающими документами — основной способ. Канал остаётся и после
// подключения эквайринга.
//
// Заявка открыта без авторизации по той же причине, что и лист ожидания:
// счёт просит бухгалтер, у которого аккаунта здесь нет и не будет.
router.post("/invoice-request", createInvoiceRequest);

// «Я оплатил» — плательщик сообщает, что отправил деньги. Без авторизации:
// доступ даёт подписанная ссылка из письма. Тариф от этого НЕ включается,
// иначе это была бы кнопка «получить тариф даром».
router.post("/invoice-claim/:token", claimInvoicePayment);
router.get(
  "/invoice-requests",
  requireAuth,
  requireAdmin,
  listInvoiceRequests,
);
router.post(
  "/invoice-requests/:id/paid",
  requireAuth,
  requireAdmin,
  markInvoicePaid,
);
// Архив: убрать с глаз → вернуть → удалить навсегда. Промежуточный шаг
// намеренный — заявка это чужое намерение заплатить, и промах по кнопке
// не должен стоить клиента, о существовании которого мы после удаления
// не узнаем.
router.post(
  "/invoice-requests/:id/archive",
  requireAuth,
  requireAdmin,
  archiveInvoiceRequest,
);
router.post(
  "/invoice-requests/:id/restore",
  requireAuth,
  requireAdmin,
  restoreInvoiceRequest,
);
router.delete(
  "/invoice-requests/:id",
  requireAuth,
  requireAdmin,
  deleteInvoiceRequest,
);

// ─── Реквизиты для оплаты ─────────────────────────────────────────────
//
// Справочник, которым администратор управляет сам: банк закрыл счёт,
// добавили карту в другой валюте, для Турции один счёт, для Азербайджана
// другой. Переменная окружения требовала бы доступа к серверу и рестарта
// на каждую правку — то есть зависимости от разработчика в вопросе, к
// разработке отношения не имеющем.
//
// Чтение закрыто админом намеренно: список реквизитов на публичной
// странице — приглашение для мошенников подменить его в почтовой рассылке.
// Заявитель получает их письмом, адресно.
router.get("/requisites", requireAuth, requireAdmin, listRequisites);
router.post("/requisites", requireAuth, requireAdmin, createRequisite);
router.patch("/requisites/:id", requireAuth, requireAdmin, updateRequisite);
router.delete("/requisites/:id", requireAuth, requireAdmin, deactivateRequisite);

// ─── Ручная выдача тарифа ─────────────────────────────────────────────
// Продажа мимо сайта (перевод, счёт), промо, компенсация, партнёрский
// доступ. Останется нужной и после запуска эквайринга.
router.post("/admin/grant", requireAuth, requireAdmin, grantPlanByAdmin);

export default router;
