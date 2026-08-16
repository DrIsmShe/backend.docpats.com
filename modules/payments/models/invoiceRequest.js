// server/modules/payments/models/invoiceRequest.js
// ─────────────────────────────────────────────────────────────────────
//   Заявка на оплату по счёту — ПАРАЛЛЕЛЬНЫЙ канал к онлайн-оплате.
//
//   Зачем отдельный канал, а не «временная замена эквайрингу»:
//
//   Бухгалтерия клиники не платит корпоративной картой. Для чека в
//   99–499 $ в месяц счёт с закрывающими документами — не запасной
//   вариант, а основной и часто единственный приемлемый. Поэтому канал
//   остаётся и после подключения онлайн-оплаты: у него своя аудитория,
//   а не свои обстоятельства.
//
//   Отличие от pricing_waitlist: лист ожидания собирает интерес («напишите
//   мне, когда запустится»), здесь человек готов платить сейчас и просит
//   счёт. Смешивать их нельзя — иначе рабочие заявки утонут в интересе.
//
//   Данные НЕ шифруются: это платёжные реквизиты юрлица, публичные по
//   своей природе, а не медицинские сведения. Медицинских данных здесь
//   быть не должно.
//
//   Оплата подтверждается вручную: администратор видит поступление на
//   счёт и отмечает заявку. Дальше тариф выдаётся тем же grantPlan, что
//   и при онлайн-оплате, и попадает в тот же реестр транзакций — иначе
//   подписки «из ниоткуда» не отличить от оплаченных.
// ─────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";

const EMAIL_MAX = 254; // предел длины адреса по RFC 5321
const NAME_MAX = 200;
const NOTE_MAX = 1000;
const TAX_ID_MAX = 50;

export const INVOICE_STATUSES = ["new", "invoiced", "paid", "cancelled"];

const invoiceRequestSchema = new mongoose.Schema(
  {
    // ─── Кто просит ───────────────────────────────────────────────
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: EMAIL_MAX,
      index: true,
    },
    // Название организации. Для частного врача — его имя.
    companyName: { type: String, required: true, trim: true, maxlength: NAME_MAX },
    contactName: { type: String, default: "", trim: true, maxlength: NAME_MAX },
    phone: { type: String, default: "", trim: true, maxlength: 40 },
    // ИНН/VAT/налоговый номер — без него счёт юрлицу не выписать.
    taxId: { type: String, default: "", trim: true, maxlength: TAX_ID_MAX },
    country: { type: String, default: "", trim: true, maxlength: 80 },

    // ─── Что покупают ─────────────────────────────────────────────
    // Ключ плана, а не название: названия меняются, ключи — нет.
    planKey: { type: String, required: true, index: true },
    period: { type: String, enum: ["monthly", "yearly"], default: "yearly" },
    // Сколько месяцев оплачивают. Счёт часто выставляют сразу на год,
    // но бывает и на квартал — фиксируем то, о чём договорились.
    months: { type: Number, default: 12, min: 1, max: 36 },

    // Кому выдавать тариф после оплаты. Может быть пустым: заявку
    // оставляют и до регистрации, тогда аккаунт заводят при обработке.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    note: { type: String, default: "", trim: true, maxlength: NOTE_MAX },

    // ─── Обработка ────────────────────────────────────────────────
    status: {
      type: String,
      enum: INVOICE_STATUSES,
      default: "new",
      index: true,
    },
    // Номер выставленного счёта — чтобы сверять с банковской выпиской.
    invoiceNumber: { type: String, default: "", trim: true, maxlength: 60 },
    invoicedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    // Кто из администраторов подтвердил оплату. Ответственность за
    // выдачу тарифа мимо эквайринга должна быть именной.
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    // Транзакция, созданная при выдаче тарифа. Связь в обе стороны:
    // от заявки к деньгам и обратно.
    transactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PaymentTransaction",
      default: null,
    },
  },
  { timestamps: true, collection: "invoice_requests" },
);

// Список обрабатывают с конца и по статусу — под это и индекс.
invoiceRequestSchema.index({ status: 1, createdAt: -1 });

// Дубли не запрещаем уникальным индексом намеренно: одна организация
// может законно просить счёт дважды — на продление, на второй тариф, на
// доплату за врачей. Уникальность здесь мешала бы работе, а не помогала.

const InvoiceRequest =
  mongoose.models.InvoiceRequest ||
  mongoose.model("InvoiceRequest", invoiceRequestSchema, "invoice_requests");

export default InvoiceRequest;
