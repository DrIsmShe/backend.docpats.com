// server/jobs/notificationDigest.job.js
// ─────────────────────────────────────────────────────────────────────
//   «Дожимающее» письмо: дайджест непрочитанных уведомлений неактивным
//   пользователям. Раз в сутки. Анти-спам:
//     - только тем, кто не заходил >= INACTIVE_DAYS,
//     - не чаще раза в COOLDOWN_DAYS (поле User.lastDigestEmailAt),
//     - у кого есть непрочитанные уведомления.
//   Без BREVO_API_KEY sendEmail просто вернёт false — писем не будет.
// ─────────────────────────────────────────────────────────────────────

import cron from "node-cron";
import User from "../common/models/Auth/users.js";
import Notification from "../common/models/Notification/notification.js";
import { sendEmail } from "../common/services/emailService.js";

const DAY = 24 * 60 * 60 * 1000;
const INACTIVE_DAYS = 2; // не заходил столько дней
const COOLDOWN_DAYS = 3; // не чаще раза в столько дней
const MAX_BATCH = 300; // предохранитель на один прогон

const FRONTEND_URL = process.env.FRONTEND_URL || "https://docpats.com";

function digestEmail({ lang, firstName, count }) {
  const name = firstName ? ` ${firstName}` : "";
  const T = {
    ru: {
      s: `У вас ${count} непрочитанных уведомлений на DocPats`,
      b: `Здравствуйте${name}! На DocPats вас ждут ${count} непрочитанных уведомлений — приёмы, сообщения, отзывы. Загляните: ${FRONTEND_URL}`,
    },
    en: {
      s: `You have ${count} unread notifications on DocPats`,
      b: `Hello${name}! You have ${count} unread notifications on DocPats — appointments, messages, reviews. Take a look: ${FRONTEND_URL}`,
    },
    az: {
      s: `DocPats-da ${count} oxunmamış bildirişiniz var`,
      b: `Salam${name}! DocPats-da sizi ${count} oxunmamış bildiriş gözləyir — qəbullar, mesajlar, rəylər. Baxın: ${FRONTEND_URL}`,
    },
    tr: {
      s: `DocPats'te ${count} okunmamış bildiriminiz var`,
      b: `Merhaba${name}! DocPats'te ${count} okunmamış bildiriminiz var — randevular, mesajlar, yorumlar. Göz atın: ${FRONTEND_URL}`,
    },
    ar: {
      s: `لديك ${count} إشعارات غير مقروءة على DocPats`,
      b: `مرحباً${name}! لديك ${count} إشعارات غير مقروءة على DocPats — مواعيد ورسائل وتقييمات. اطّلع: ${FRONTEND_URL}`,
    },
  };
  const t = T[lang] || T.ru;
  return { subject: t.s, body: t.b };
}

/**
 * Кто должен получить дайджест прямо сейчас. Вынесено отдельно для тестов.
 * @returns {Promise<Array<{ user, count }>>}
 */
export async function selectDigestRecipients(now = new Date()) {
  const inactiveBefore = new Date(now.getTime() - INACTIVE_DAYS * DAY);
  const cooldownBefore = new Date(now.getTime() - COOLDOWN_DAYS * DAY);

  // userIds с непрочитанными уведомлениями.
  const agg = await Notification.aggregate([
    { $match: { isRead: false } },
    { $group: { _id: "$userId", count: { $sum: 1 } } },
  ]);
  if (!agg.length) return [];

  const counts = new Map(agg.map((a) => [String(a._id), a.count]));
  const ids = agg.map((a) => a._id).filter(Boolean);

  // $lt по дате матчит только реальные даты старше порога (null/missing — нет).
  const users = await User.find({
    _id: { $in: ids },
    isDeleted: { $ne: true },
    role: { $in: ["patient", "doctor", "user"] },
    lastLoginAt: { $lt: inactiveBefore },
    $or: [
      { lastDigestEmailAt: null },
      { lastDigestEmailAt: { $exists: false } },
      { lastDigestEmailAt: { $lt: cooldownBefore } },
    ],
  })
    .select(
      "_id role username preferredLanguage emailEncrypted firstNameEncrypted lastLoginAt lastDigestEmailAt",
    )
    .limit(MAX_BATCH);

  return users.map((u) => ({ user: u, count: counts.get(String(u._id)) || 0 }));
}

/** Прогон рассылки. */
export async function runNotificationDigest(now = new Date()) {
  const recipients = await selectDigestRecipients(now);
  let sent = 0;
  let errors = 0;

  for (const { user, count } of recipients) {
    try {
      let emailPlain = null;
      let firstName = "";
      if (typeof user.decryptFields === "function") {
        const f = user.decryptFields();
        emailPlain = f.email;
        firstName = f.firstName || "";
      }
      // Помечаем всегда — анти-спам важнее одной пропущенной отправки.
      await User.updateOne(
        { _id: user._id },
        { $set: { lastDigestEmailAt: now } },
      );
      if (!emailPlain) continue;

      const lang = user.preferredLanguage || "ru";
      const { subject, body } = digestEmail({ lang, firstName, count });
      const ok = await sendEmail(emailPlain, subject, body);
      if (ok) sent += 1;
      else errors += 1;
    } catch (e) {
      errors += 1;
    }
  }

  return { candidates: recipients.length, sent, errors };
}

/** Регистрация cron — ежедневно в 10:00 UTC. */
export function scheduleNotificationDigest() {
  cron.schedule("0 10 * * *", async () => {
    try {
      const r = await runNotificationDigest();
      console.log(
        `📧 Notification digest: candidates=${r.candidates} sent=${r.sent} errors=${r.errors}`,
      );
    } catch (err) {
      console.error("❌ Notification digest cron error:", err.message);
    }
  });
  console.log("⏰ Notification digest cron активен (ежедневно 10:00 UTC)");
}
