// server/modules/payments/controllers/grant.controller.js
// ─────────────────────────────────────────────────────────────────────
//   Ручная выдача тарифа или аддона администратором.
//
//   Зачем это нужно и после запуска эквайринга: продажа по счёту
//   юрлицу, промо, партнёрский доступ, компенсация за инцидент,
//   тестовые аккаунты. Эквайринг это не покрывает.
//
//   Ключевое требование: выдача ОБЯЗАНА оставлять запись в том же
//   реестре транзакций, что и оплата. Иначе в базе появятся подписки
//   из ниоткуда, которые не отличить от оплаченных, и первый же
//   финансовый отчёт разъедется. Поэтому пишем provider: "local",
//   amount: 0 и в meta — кто выдал, кому и почему.
// ─────────────────────────────────────────────────────────────────────

import User from "../../../common/models/Auth/users.js";
import PaymentTransaction from "../models/paymentTransaction.js";
import { grantPlan } from "../services/subscription.service.js";

/**
 * POST /api/payments/admin/grant
 * { userId, planKey, months, reason }
 */
export async function grantPlanByAdmin(req, res) {
  try {
    const { userId, planKey, months, reason } = req.body || {};

    if (!userId || !planKey) {
      return res
        .status(400)
        .json({ success: false, message: "userId и planKey обязательны" });
    }
    // Причина обязательна намеренно: запись без объяснения через полгода
    // читается как «непонятно откуда у него Pro».
    const cleanReason = String(reason ?? "").trim();
    if (cleanReason.length < 3) {
      return res.status(400).json({
        success: false,
        message: "Укажите причину выдачи — она попадёт в журнал",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "Пользователь не найден" });
    }

    const count = Number(months ?? 1);
    let result;
    try {
      result = await grantPlan(user, { planKey, months: count });
    } catch (e) {
      return res.status(400).json({ success: false, message: e.message });
    }

    // Запись в реестр — вместе с выдачей, а не «когда-нибудь потом».
    const tx = await PaymentTransaction.create({
      userId: user._id,
      kind: "subscription",
      planKey,
      period: null, // срок задан месяцами, а не тарифным периодом
      amount: 0,
      currency: "USD",
      provider: "local",
      providerRef: null,
      status: "paid",
      paidAt: new Date(),
      meta: {
        manual: true,
        grantedBy: String(req.session.userId),
        months: count,
        reason: cleanReason.slice(0, 500),
      },
    });

    return res.status(200).json({
      success: true,
      transactionId: tx._id,
      months: count,
      ...result,
    });
  } catch (err) {
    console.error("grantPlanByAdmin error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}
