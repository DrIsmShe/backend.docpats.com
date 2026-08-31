import { tReq } from "../../../common/i18n/index.js";
// server/modules/payments/controllers/requisites.controller.js
// ─────────────────────────────────────────────────────────────────────
//   Реквизиты для оплаты: справочник, которым администратор управляет
//   сам, без разработчика и без рестарта сервера.
//
//   Удаление мягкое (isActive: false): реквизит, по которому уже платили,
//   нужен, чтобы разобрать старые поступления.
// ─────────────────────────────────────────────────────────────────────

import PaymentRequisite, {
  REQUISITE_KINDS,
} from "../models/paymentRequisite.js";

/** Действующие реквизиты в порядке показа. Используется и письмами. */
export async function activeRequisites() {
  return PaymentRequisite.find({ isActive: true })
    .sort({ sortOrder: 1, createdAt: 1 })
    .lean();
}

// Как способ оплаты выглядит для человека. Одни и те же реквизиты
// используются по-разному: по банковскому счёту платят в отделении или
// из интернет-банка, на карту переводят из приложения. Подпись экономит
// заявителю вопрос «а это куда вообще».
const KIND_HINT = {
  bank: "перевод из банка или интернет-банка",
  card: "перевод на карту из приложения банка",
  other: "",
};

/**
 * Реквизиты текстом — для писем.
 *
 * Подаются КАК ВЫБОР, а не списком: заявитель платит одним способом, и
 * без явного «любым из них» он гадает, не нужно ли отправить дважды.
 * Нумерация здесь несёт смысл — это варианты, между которыми выбирают.
 *
 * Возвращает пустую строку, если ничего не заведено: письмо тогда просто
 * не содержит блока с оплатой, а не показывает пустой заголовок.
 */
export async function requisitesAsText() {
  const items = await activeRequisites();
  if (!items.length) return "";

  const single = items.length === 1;

  const blocks = items.map((r, i) => {
    const head = [
      single ? "" : `${i + 1}. `,
      r.title,
      r.currency ? ` (${r.currency})` : "",
      KIND_HINT[r.kind] ? ` — ${KIND_HINT[r.kind]}` : "",
    ].join("");

    // Отступ в две позиции: в почтовом клиенте без разметки это
    // единственный способ показать, что строки относятся к пункту выше.
    const body = r.details
      .split("\n")
      .map((line) => (single ? line : `   ${line}`))
      .join("\n");

    const note = r.note ? `${single ? "" : "   "}→ ${r.note}` : "";

    return [head, body, note].filter(Boolean).join("\n");
  });

  const intro = single
    ? "Реквизиты для оплаты:"
    : "Выберите удобный способ — оплатить нужно один раз, любым из них:";

  return `${intro}\n\n${blocks.join("\n\n")}`;
}

/** GET /api/payments/requisites — все, включая отключённые (для админки). */
export async function listRequisites(req, res) {
  try {
    const all = req.query?.all === "true";
    const filter = all ? {} : { isActive: true };
    const items = await PaymentRequisite.find(filter)
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();
    return res.status(200).json({ success: true, count: items.length, items });
  } catch (err) {
    console.error("listRequisites error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

function readBody(body = {}) {
  const title = String(body.title ?? "").trim();
  const details = String(body.details ?? "").trim();
  return {
    title,
    details,
    kind: REQUISITE_KINDS.includes(body.kind) ? body.kind : "bank",
    currency: String(body.currency ?? "USD").trim().slice(0, 10),
    note: String(body.note ?? "").trim().slice(0, 500),
    sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
    isActive: body.isActive === undefined ? true : Boolean(body.isActive),
  };
}

/** POST /api/payments/requisites */
export async function createRequisite(req, res) {
  try {
    const data = readBody(req.body);
    if (data.title.length < 2 || data.details.length < 4) {
      return res.status(400).json({
        success: false,
        message: tReq(req, "app.paymentDetails.nameAndDetailsRequired"),
      });
    }

    const doc = await PaymentRequisite.create({
      ...data,
      updatedBy: req.session.userId,
    });
    return res.status(201).json({ success: true, item: doc });
  } catch (err) {
    console.error("createRequisite error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

/** PATCH /api/payments/requisites/:id */
export async function updateRequisite(req, res) {
  try {
    const doc = await PaymentRequisite.findById(req.params.id);
    if (!doc) {
      return res
        .status(404)
        .json({ success: false, message: tReq(req, "app.paymentDetails.notFound") });
    }

    // Правим только присланные поля: частичное обновление не должно
    // затирать то, чего в запросе не было.
    const body = req.body || {};
    if (body.title !== undefined) doc.title = String(body.title).trim();
    if (body.details !== undefined) doc.details = String(body.details).trim();
    if (body.note !== undefined) doc.note = String(body.note).trim();
    if (body.currency !== undefined) doc.currency = String(body.currency).trim();
    if (body.kind !== undefined && REQUISITE_KINDS.includes(body.kind)) {
      doc.kind = body.kind;
    }
    if (body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))) {
      doc.sortOrder = Number(body.sortOrder);
    }
    if (body.isActive !== undefined) doc.isActive = Boolean(body.isActive);

    if (!doc.title || !doc.details) {
      return res.status(400).json({
        success: false,
        message: tReq(req, "app.paymentDetails.cannotBeEmpty"),
      });
    }

    doc.updatedBy = req.session.userId;
    await doc.save();
    return res.status(200).json({ success: true, item: doc });
  } catch (err) {
    console.error("updateRequisite error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * DELETE /api/payments/requisites/:id — мягко.
 *
 * Реквизит, по которому уже платили, нужен для разбора старых
 * поступлений. Поэтому отключаем, а не стираем.
 */
export async function deactivateRequisite(req, res) {
  try {
    const doc = await PaymentRequisite.findById(req.params.id);
    if (!doc) {
      return res
        .status(404)
        .json({ success: false, message: tReq(req, "app.paymentDetails.notFound") });
    }
    doc.isActive = false;
    doc.updatedBy = req.session.userId;
    await doc.save();
    return res.status(200).json({ success: true, item: doc });
  } catch (err) {
    console.error("deactivateRequisite error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}
