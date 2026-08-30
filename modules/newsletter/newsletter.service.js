// modules/newsletter/newsletter.service.js
//
// Подписка гостя на рассылку: приём адреса, подтверждение, отписка.
//
// Ключевое правило — адрес не считается подписанным, пока владелец не
// перешёл по ссылке из письма. Всё остальное здесь следует из него.

import crypto from "node:crypto";
import NewsletterSubscriber, {
  hashEmail,
} from "../../common/models/Newsletter/newsletterSubscriber.js";
import { sendEmail } from "../../common/services/emailService.js";
import logger from "../../common/logger.js";

const log = logger.child({ module: "newsletter" });

// Повторное письмо-подтверждение не чаще раза в 10 минут на адрес: иначе
// формой можно засыпать чужой почтовый ящик.
const RESEND_COOLDOWN_MS = 10 * 60 * 1000;

// Ссылка живёт неделю. Дольше — токен превращается в вечный ключ к
// чужому адресу; короче — человек не успеет открыть почту.
const CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const hashToken = (t) =>
  crypto.createHash("sha256").update(String(t)).digest("hex");

function siteUrl() {
  return (process.env.FRONTEND_URL || "https://docpats.com").replace(/\/$/, "");
}

export function isValidEmail(v) {
  const s = String(v || "").trim();
  return s.length <= 254 && EMAIL_RE.test(s);
}

/**
 * Подписка. Возвращает {status} — и НИКОГДА не говорит, был ли адрес в
 * базе: иначе формой можно проверять, зарегистрирован ли человек.
 *
 * status: "sent" — письмо ушло, "already" — уже подтверждён,
 *         "throttled" — недавно отправляли.
 */
export async function subscribe({ email, audience, locale, source }) {
  const clean = String(email).trim().toLowerCase();
  const emailHash = hashEmail(clean);

  let doc = await NewsletterSubscriber.findOne({ emailHash });

  if (doc?.confirmedAt && !doc.unsubscribedAt) {
    return { status: "already" };
  }

  if (
    doc?.confirmSentAt &&
    Date.now() - new Date(doc.confirmSentAt).getTime() < RESEND_COOLDOWN_MS
  ) {
    return { status: "throttled" };
  }

  const token = crypto.randomBytes(32).toString("hex");

  if (!doc) {
    doc = new NewsletterSubscriber();
    NewsletterSubscriber.setEmail(doc, clean);
  }
  doc.audience = audience === "doctor" ? "doctor" : "patient";
  doc.locale = locale || "ru";
  doc.source = source || "modal";
  doc.confirmTokenHash = hashToken(token);
  doc.confirmSentAt = new Date();
  // Повторная подписка после отписки — снимаем отметку, но подтверждение
  // всё равно требуется заново.
  doc.unsubscribedAt = null;
  doc.confirmedAt = null;
  await doc.save();

  await sendConfirmation(clean, token, doc.locale);
  log.info({ audience: doc.audience, locale: doc.locale }, "Отправлено подтверждение подписки");

  return { status: "sent" };
}

const TEXTS = {
  ru: {
    subject: "Подтвердите подписку на рассылку DocPats",
    hi: "Здравствуйте!",
    body: "Кто-то указал этот адрес для подписки на еженедельную рассылку DocPats. Если это вы — подтвердите адрес одной кнопкой.",
    cta: "Подтвердить подписку",
    ignore: "Если вы этого не делали, просто не отвечайте на письмо: без подтверждения мы ничего не пришлём.",
  },
  en: {
    subject: "Confirm your DocPats newsletter subscription",
    hi: "Hello,",
    body: "Someone entered this address to subscribe to the weekly DocPats digest. If that was you, confirm the address with one click.",
    cta: "Confirm subscription",
    ignore: "If it wasn't you, simply ignore this email — without confirmation we will not send anything.",
  },
  az: {
    subject: "DocPats xəbər bülleteninə abunəliyi təsdiqləyin",
    hi: "Salam!",
    body: "Kimsə bu ünvanı DocPats həftəlik bülleteninə abunə olmaq üçün göstərib. Bu sizsinizsə, ünvanı bir kliklə təsdiqləyin.",
    cta: "Abunəliyi təsdiqlə",
    ignore: "Bunu siz etməmisinizsə, məktubu nəzərə almayın: təsdiq olmadan heç nə göndərməyəcəyik.",
  },
  tr: {
    subject: "DocPats bültenine aboneliğinizi onaylayın",
    hi: "Merhaba,",
    body: "Birisi bu adresi DocPats haftalık bültenine abone olmak için girdi. Bu sizseniz, adresi tek tıkla onaylayın.",
    cta: "Aboneliği onayla",
    ignore: "Bunu siz yapmadıysanız e-postayı yok sayın: onay olmadan hiçbir şey göndermeyiz.",
  },
  ar: {
    subject: "أكد اشتراكك في نشرة DocPats",
    hi: "مرحباً،",
    body: "أدخل أحدهم هذا العنوان للاشتراك في نشرة DocPats الأسبوعية. إن كنت أنت، فأكد العنوان بضغطة واحدة.",
    cta: "تأكيد الاشتراك",
    ignore: "إن لم تكن أنت، فتجاهل الرسالة: لن نرسل شيئاً دون تأكيد.",
  },
};

async function sendConfirmation(email, token, locale) {
  const t = TEXTS[locale] || TEXTS.ru;
  const link = `${siteUrl()}/newsletter/confirm?token=${token}`;
  const dir = locale === "ar" ? "rtl" : "ltr";

  const html = `
    <div dir="${dir}" style="font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1f2937">
      <div style="font-size:22px;font-weight:700;color:#0f172a;margin-bottom:18px">DocPats</div>
      <p style="font-size:16px;margin:0 0 10px">${t.hi}</p>
      <p style="font-size:15px;line-height:1.65;margin:0 0 22px;color:#334155">${t.body}</p>
      <a href="${link}" style="display:inline-block;padding:14px 28px;background:#0f766e;color:#fff;border-radius:10px;text-decoration:none;font-size:15px;font-weight:600">${t.cta}</a>
      <p style="font-size:13px;line-height:1.6;margin:26px 0 0;color:#64748b">${t.ignore}</p>
    </div>`;

  await sendEmail([email], t.subject, `${t.body}

${link}`, { html });
}

/** Подтверждение адреса по токену из письма. */
export async function confirm(token) {
  if (!token || typeof token !== "string") return { ok: false, reason: "bad_token" };

  const doc = await NewsletterSubscriber.findOne({
    confirmTokenHash: hashToken(token),
  });
  if (!doc) return { ok: false, reason: "bad_token" };

  if (
    doc.confirmSentAt &&
    Date.now() - new Date(doc.confirmSentAt).getTime() > CONFIRM_TTL_MS
  ) {
    return { ok: false, reason: "expired" };
  }

  doc.confirmedAt = new Date();
  // Токен одноразовый: подтвердили — и он больше ни на что не годится.
  doc.confirmTokenHash = null;
  doc.unsubscribedAt = null;
  await doc.save();

  return { ok: true, audience: doc.audience, locale: doc.locale };
}

/** Отписка по адресу. Молчаливая: отвечаем одинаково в любом случае. */
export async function unsubscribeByEmail(email, reason) {
  const doc = await NewsletterSubscriber.findOne({ emailHash: hashEmail(email) });
  if (!doc) return { ok: true };
  doc.unsubscribedAt = new Date();
  doc.unsubscribeReason = reason ? String(reason).slice(0, 200) : null;
  await doc.save();
  return { ok: true };
}
