// common/models/Newsletter/newsletterSubscriber.js
//
// Подписчик рассылки, у которого НЕТ аккаунта на сайте.
//
// Зачем отдельная сущность. У зарегистрированных врачей и пациентов
// подписка уже есть — это флаги emailDigestEnabled и
// conferenceDigestEnabled в учётной записи. Гостю же подписаться было
// негде: аккаунта нет, значит нет и места, где хранить согласие.
//
// ПОДТВЕРЖДЕНИЕ АДРЕСА ОБЯЗАТЕЛЬНО, и это не формальность. Адрес вводит
// кто угодно и какой угодно — в том числе чужой. Письма уходят с того же
// домена, что и подтверждения записи к врачу; жалобы на спам бьют по
// репутации домена целиком, и переставать доходить начнут в первую
// очередь клинические уведомления. Поэтому в рассылку попадает только
// адрес, владелец которого перешёл по ссылке из письма.
//
// Адрес хранится зашифрованным, а искать по нему позволяет отдельный
// хеш — та же схема, что у карт пациентов и сотрудников клиники.

import mongoose from "mongoose";
import crypto from "node:crypto";
import { encryptPHI, decryptPHI } from "../../utils/phiCrypto.js";

const AUDIENCES = ["doctor", "patient"];

// Слепой индекс: по нему ищем, не расшифровывая базу целиком.
export const hashEmail = (v) =>
  v == null
    ? v
    : crypto
        .createHash("sha256")
        .update(String(v).trim().toLowerCase())
        .digest("hex");

const newsletterSubscriberSchema = new mongoose.Schema(
  {
    emailEncrypted: { type: String, required: true },
    // unique: один адрес — одна запись, повторная подписка обновляет её,
    // а не плодит дубли и не шлёт второе письмо-подтверждение.
    emailHash: { type: String, required: true, unique: true, index: true },

    // Кому пишем. От этого зависит содержимое: врачу — новости по
    // специальности и конференции, пациенту — разбор понятным языком.
    // Одно письмо на обе аудитории хуже для обеих.
    audience: { type: String, enum: AUDIENCES, default: "patient" },

    // Язык письма. Берём тот, на котором человек читал сайт.
    locale: { type: String, default: "ru", maxlength: 5 },

    // ── Подтверждение ──────────────────────────────────────────────
    confirmedAt: { type: Date, default: null, index: true },
    // Хранится ХЕШ токена, а не сам токен: утечка базы не должна давать
    // возможность подтверждать чужие адреса.
    confirmTokenHash: { type: String, default: null, index: true },
    confirmSentAt: { type: Date, default: null },

    // ── Отписка ────────────────────────────────────────────────────
    unsubscribedAt: { type: Date, default: null, index: true },
    unsubscribeReason: { type: String, default: null, maxlength: 200 },

    // Откуда пришёл — чтобы понимать, какие места приводят подписчиков.
    // Ни IP, ни устройства не храним: для рассылки они не нужны.
    source: { type: String, default: "modal", maxlength: 40 },

    lastSentAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "newsletter_subscribers" },
);

// Активные получатели: подтвердили и не отписались.
newsletterSubscriberSchema.index({ confirmedAt: 1, unsubscribedAt: 1, audience: 1 });

newsletterSubscriberSchema.virtual("email").get(function () {
  return this.emailEncrypted ? decryptPHI(this.emailEncrypted) : null;
});

newsletterSubscriberSchema.statics.setEmail = function (doc, email) {
  const clean = String(email || "").trim().toLowerCase();
  doc.emailEncrypted = encryptPHI(clean);
  doc.emailHash = hashEmail(clean);
  return doc;
};

const NewsletterSubscriber =
  mongoose.models.NewsletterSubscriber ||
  mongoose.model("NewsletterSubscriber", newsletterSubscriberSchema);

export { AUDIENCES };
export default NewsletterSubscriber;
