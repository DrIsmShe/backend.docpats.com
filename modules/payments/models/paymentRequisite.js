// server/modules/payments/models/paymentRequisite.js
// ─────────────────────────────────────────────────────────────────────
//   Реквизиты для оплаты по счёту: куда заявителю отправлять деньги.
//
//   ПОЧЕМУ ОТДЕЛЬНАЯ КОЛЛЕКЦИЯ, А НЕ ПЕРЕМЕННАЯ ОКРУЖЕНИЯ. Реквизиты
//   меняются: банк закрыл счёт, добавили карту в другой валюте, для
//   Турции один счёт, для Азербайджана другой. Переменная окружения
//   требует доступа к серверу и рестарта на каждую правку — то есть
//   администратор зависит от разработчика в вопросе, который к разработке
//   отношения не имеет.
//
//   НЕСКОЛЬКО СПОСОБОВ ОДНОВРЕМЕННО — это не усложнение, а обычная
//   ситуация: юрлицу нужен банковский счёт с назначением платежа, а
//   частному врачу проще перевести на карту. В письмо уходят все
//   действующие, заявитель выбирает.
//
//   ЭТО НЕ СЕКРЕТ. Номер счёта для приёма платежей публичен по своей
//   природе — его печатают на бланках. Поэтому не шифруем: шифрование
//   здесь создало бы иллюзию защиты и мешало бы поиску.
//
//   УДАЛЕНИЕ МЯГКОЕ. Реквизит, по которому уже платили, нужен для разбора
//   старых платежей: «на какой счёт пришли эти деньги в марте». Поэтому
//   isActive: false вместо удаления записи.
// ─────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";

const TITLE_MAX = 120;
const DETAILS_MAX = 2000;
const NOTE_MAX = 500;

export const REQUISITE_KINDS = ["bank", "card", "other"];

const paymentRequisiteSchema = new mongoose.Schema(
  {
    // Что видит заявитель в письме: «Банковский перевод, USD».
    title: { type: String, required: true, trim: true, maxlength: TITLE_MAX },

    // Вид — чтобы интерфейс мог сгруппировать и подсказать формат.
    kind: { type: String, enum: REQUISITE_KINDS, default: "bank" },

    // Сами реквизиты, как их надо показать: многострочный текст.
    // Свободная форма намеренно — набор полей у банковского счёта,
    // карты и электронного кошелька разный, и загонять их в одну схему
    // значит однажды не суметь вписать нужное.
    details: { type: String, required: true, trim: true, maxlength: DETAILS_MAX },

    currency: { type: String, default: "USD", trim: true, maxlength: 10 },

    // Пояснение: «в назначении платежа укажите номер счёта».
    note: { type: String, default: "", trim: true, maxlength: NOTE_MAX },

    isActive: { type: Boolean, default: true, index: true },

    // Порядок в письме и на странице: сверху тот, которым платят чаще.
    sortOrder: { type: Number, default: 0 },

    // Кто последний правил — реквизиты касаются денег, и правка должна
    // быть именной.
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true, collection: "payment_requisites" },
);

paymentRequisiteSchema.index({ isActive: 1, sortOrder: 1 });

const PaymentRequisite =
  mongoose.models.PaymentRequisite ||
  mongoose.model("PaymentRequisite", paymentRequisiteSchema, "payment_requisites");

export default PaymentRequisite;
