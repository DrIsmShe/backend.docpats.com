// server/modules/payments/models/pricingWaitlist.js
// ─────────────────────────────────────────────────────────────────────
//   Лист ожидания запуска оплаты.
//
//   Пока касса закрыта (PAYMENTS_PROVIDER=mock), кнопка «Подключить»
//   вместо оплаты собирает контакт: кто и каким тарифом интересуется.
//   Это единственный способ узнать спрос и проверить цены ДО регистрации
//   бизнеса — иначе к моменту запуска эквайринга у нас не будет ни
//   одного подтверждения, что за это готовы платить.
//
//   Данные НЕ шифруются — тот же подход, что у clinic-leads: это
//   контакт потенциального покупателя, а не медицинские сведения.
//   Медицинских данных здесь быть не должно в принципе.
//
//   userId заполняется, только если человек авторизован. Гость оставляет
//   один email — он и есть основная аудитория листа.
// ─────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";

const EMAIL_MAX = 254; // предел длины адреса по RFC 5321
const NOTE_MAX = 500;

const pricingWaitlistSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: EMAIL_MAX,
      index: true,
    },

    // Какой тариф или аддон человек хотел подключить. Ключ, а не
    // название: названия меняются, ключи — нет.
    planKey: { type: String, default: null, index: true },
    period: {
      type: String,
      enum: ["monthly", "yearly", null],
      default: null,
    },

    // Если оставлял авторизованный — связываем, чтобы при запуске
    // написать ему точечно, а не в общую рассылку.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    // Откуда пришёл: страница тарифов, баннер исчерпанной квоты и т.д.
    source: { type: String, default: "pricing", maxlength: 60 },

    note: { type: String, default: "", trim: true, maxlength: NOTE_MAX },

    // Отметка «связались» — чтобы список был рабочим инструментом,
    // а не свалкой адресов.
    contactedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "pricing_waitlist" },
);

// Один и тот же человек может интересоваться разными тарифами, но
// дважды одним и тем же — нет: повторная отправка формы должна
// обновлять запись, а не плодить дубли.
pricingWaitlistSchema.index({ email: 1, planKey: 1 }, { unique: true });
pricingWaitlistSchema.index({ createdAt: -1 });

const PricingWaitlist =
  mongoose.models.PricingWaitlist ||
  mongoose.model("PricingWaitlist", pricingWaitlistSchema, "pricing_waitlist");

export default PricingWaitlist;
