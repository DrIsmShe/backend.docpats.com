// server/modules/payments/controllers/waitlist.controller.js
// ─────────────────────────────────────────────────────────────────────
//   Лист ожидания запуска оплаты: приём заявки и выгрузка для админа.
// ─────────────────────────────────────────────────────────────────────

import PricingWaitlist from "../models/pricingWaitlist.js";
import {
  PLAN_PRICES,
  EXAM_ADDON_PRICES,
} from "../../../common/config/aiPlanLimits.js";

// Проверка ровно на то, что адрес похож на адрес. Валидировать email
// регуляркой строже бессмысленно: единственная настоящая проверка —
// письмо, которое дойдёт.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function isKnownPlan(planKey) {
  return Boolean(PLAN_PRICES[planKey] || EXAM_ADDON_PRICES[planKey]);
}

/**
 * POST /api/payments/waitlist — оставить контакт до запуска оплаты.
 *
 * Без авторизации: интерес к тарифу оставляет и гость, который ещё не
 * завёл аккаунт, — он и есть будущий покупатель.
 */
export async function joinWaitlist(req, res) {
  try {
    const { email, planKey, period, note, source } = req.body || {};

    const clean = String(email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(clean)) {
      return res
        .status(400)
        .json({ success: false, message: "Некорректный email" });
    }

    // Неизвестный ключ тарифа не повод отказывать: заявка ценнее
    // аккуратности поля. Просто не сохраняем мусор.
    const plan = isKnownPlan(planKey) ? planKey : null;

    // upsert, а не create: повторная отправка формы должна обновлять
    // запись, а не плодить дубли и не падать на уникальном индексе.
    const doc = await PricingWaitlist.findOneAndUpdate(
      { email: clean, planKey: plan },
      {
        $set: {
          period: period === "monthly" || period === "yearly" ? period : null,
          note: String(note ?? "").slice(0, 500),
          source: String(source ?? "pricing").slice(0, 60),
          ...(req.session?.userId ? { userId: req.session.userId } : {}),
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    return res.status(201).json({
      success: true,
      id: doc._id,
      // Клиенту важно только «приняли» — списка мы не показываем.
      message: "Заявка принята",
    });
  } catch (err) {
    console.error("joinWaitlist error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * GET /api/payments/waitlist — список заявок для админа.
 *
 * ?format=csv отдаёт выгрузку файлом: список нужен в почтовой рассылке
 * и в таблице, а не только на экране.
 */
export async function listWaitlist(req, res) {
  try {
    const { planKey, format } = req.query || {};
    const query = {};
    if (planKey) query.planKey = planKey;

    const items = await PricingWaitlist.find(query)
      .sort({ createdAt: -1 })
      .limit(5000)
      .lean();

    if (format === "csv") {
      const header = "email,planKey,period,source,createdAt,contactedAt";
      const rows = items.map((i) =>
        [
          i.email,
          i.planKey ?? "",
          i.period ?? "",
          i.source ?? "",
          i.createdAt?.toISOString() ?? "",
          i.contactedAt?.toISOString() ?? "",
        ]
          // Экранируем кавычки и оборачиваем: в note и source может
          // оказаться запятая, и таблица разъедется.
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      );
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="pricing-waitlist.csv"',
      );
      return res.status(200).send([header, ...rows].join("\n"));
    }

    // Сводка по тарифам — то, ради чего лист и собирается: какой тариф
    // ждут чаще.
    const byPlan = {};
    for (const i of items) {
      const key = i.planKey ?? "unknown";
      byPlan[key] = (byPlan[key] ?? 0) + 1;
    }

    return res
      .status(200)
      .json({ success: true, count: items.length, byPlan, items });
  } catch (err) {
    console.error("listWaitlist error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}
