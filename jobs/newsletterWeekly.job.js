// jobs/newsletterWeekly.job.js
//
// Еженедельное письмо подписчикам-гостям.
//
// Содержимое подбирается по аудитории, а не одно на всех: врачу нужны
// разборы и конференции, пациенту — только разборы. Одно письмо на обе
// аудитории хуже для обеих.
//
// ПИСЬМО УХОДИТ ТОЛЬКО ПОДТВЕРЖДЁННЫМ АДРЕСАМ. Это не осторожность ради
// осторожности: рассылка идёт с того же домена, что и подтверждения
// записи к врачу, и жалобы на спам бьют по доставляемости клинических
// уведомлений.
//
// Выключатель: NEWSLETTER_WEEKLY=off.

import cron from "node-cron";
import mongoose from "mongoose";
import NewsletterSubscriber from "../common/models/Newsletter/newsletterSubscriber.js";
import { sendEmail, escapeHtml } from "../common/services/emailService.js";
import { unsubscribeUrl } from "../common/services/unsubscribeToken.js";
import logger from "../common/logger.js";

const log = logger.child({ module: "jobs/newsletter-weekly" });

const NEWS_DB_NAME = process.env.NEWS_DB_NAME || "DOCPATS_AI_NEWS";
const CRON = process.env.NEWSLETTER_WEEKLY_CRON || "0 8 * * 3";
const ARTICLES = 4;
const CONFERENCES = 3;

function newsDb() {
  return mongoose.connection.getClient().db(NEWS_DB_NAME);
}

function siteUrl() {
  return (process.env.FRONTEND_URL || "https://docpats.com").replace(/\/$/, "");
}

// Первый абзац как анонс: тянуть в письмо всю статью незачем — задача
// письма привести на сайт, а не заменить его.
function firstParagraph(body) {
  const text = String(body || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= 180) return text;
  const cut = text.slice(0, 180);
  const stop = cut.lastIndexOf(". ");
  return stop > 90 ? cut.slice(0, stop + 1) : cut.trimEnd() + "…";
}

async function latestArticles(locale) {
  // Берём только те статьи, которые ПЕРЕВЕДЕНЫ на язык подписчика.
  //
  // Подписчик выбрал язык писем сам, и подмешивать в письмо материалы на
  // другом языке нельзя: человек, выбравший азербайджанский, получал бы
  // русские заголовки и не понимал, почему. Лучше более короткое письмо,
  // чем письмо на двух языках.
  //
  // Оригинал написан по-русски, поэтому для ru перевод не требуется.
  const query =
    locale === "ru"
      ? { status: "published" }
      : {
          status: "published",
          [`translations.${locale}.title`]: { $exists: true, $ne: "" },
        };

  const rows = await newsDb()
    .collection("syntheses")
    .find(query)
    .sort({ createdAt: -1 })
    .limit(ARTICLES)
    .toArray();

  return rows.map((a) => {
    const tr = locale === "ru" ? null : a.translations?.[locale];
    return {
      title: tr?.title || a.title || "",
      teaser: firstParagraph(tr?.body || a.body || ""),
      url: `${siteUrl()}/articles/${a._id}/${locale}`,
    };
  });
}

async function upcomingConferences(locale) {
  // Правило то же, что у статей, но язык оригинала другой: конференции
  // приходят с сайтов обществ по-английски и переводятся на остальные
  // четыре, а статьи пишутся по-русски и переводятся на английский в том
  // числе. Поэтому «оригинал вместо перевода» здесь означает en, а там ru.
  const base = { status: "published", startDate: { $gte: new Date() } };
  const query =
    locale === "en"
      ? base
      : {
          ...base,
          [`translations.${locale}.title`]: { $exists: true, $ne: "" },
        };

  const rows = await newsDb()
    .collection("conferences")
    .find(query)
    .sort({ startDate: 1 })
    .limit(CONFERENCES)
    .toArray();

  return rows.map((c) => {
    const tr = locale === "en" ? null : c.translations?.[locale];
    return {
      title: tr?.title || c.title || "",
      where: [c.city, c.country].filter(Boolean).join(", "),
      when: c.startDate ? new Date(c.startDate).toISOString().slice(0, 10) : "",
      url: `${siteUrl()}/conferences/${c.slug}`,
    };
  });
}

// Подписи письма. Тот же набор языков, что на сайте.
const L = {
  ru: { subject: "DocPats: подборка недели", hi: "Подборка недели",
        articles: "Разборы и исследования", confs: "Ближайшие конференции",
        unsub: "Отписаться", open: "Читать" },
  en: { subject: "DocPats: this week", hi: "This week",
        articles: "Analysis and research", confs: "Upcoming conferences",
        unsub: "Unsubscribe", open: "Read" },
  az: { subject: "DocPats: həftənin seçimi", hi: "Həftənin seçimi",
        articles: "Təhlillər və araşdırmalar", confs: "Yaxın konfranslar",
        unsub: "Abunəlikdən çıx", open: "Oxu" },
  tr: { subject: "DocPats: bu hafta", hi: "Bu hafta",
        articles: "Analizler ve araştırmalar", confs: "Yaklaşan konferanslar",
        unsub: "Abonelikten çık", open: "Oku" },
  ar: { subject: "DocPats: مختارات الأسبوع", hi: "مختارات الأسبوع",
        articles: "تحليلات وأبحاث", confs: "المؤتمرات القادمة",
        unsub: "إلغاء الاشتراك", open: "اقرأ" },
};

function buildHtml({ locale, articles, conferences, unsubUrl }) {
  const t = L[locale] || L.ru;
  const dir = locale === "ar" ? "rtl" : "ltr";

  const article = (a) => `
    <div style="padding:16px 0;border-bottom:1px solid #e6eaf0">
      <a href="${a.url}" style="font-size:16px;font-weight:600;color:#0f172a;text-decoration:none;line-height:1.4">${escapeHtml(a.title)}</a>
      <div style="font-size:14px;line-height:1.6;color:#475569;margin:6px 0 8px">${escapeHtml(a.teaser)}</div>
      <a href="${a.url}" style="font-size:13px;color:#0f766e;text-decoration:none;font-weight:600">${t.open}</a>
    </div>`;

  const conf = (c) => `
    <div style="padding:12px 0;border-bottom:1px solid #e6eaf0">
      <a href="${c.url}" style="font-size:15px;font-weight:600;color:#0f172a;text-decoration:none">${escapeHtml(c.title)}</a>
      <div style="font-size:13px;color:#64748b;margin-top:4px">${escapeHtml([c.when, c.where].filter(Boolean).join(" - "))}</div>
    </div>`;

  const section = (title, inner) =>
    inner
      ? `<div style="margin-top:26px"><div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0f766e;margin-bottom:4px">${title}</div>${inner}</div>`
      : "";

  return `
  <div dir="${dir}" style="font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;padding:26px;color:#1f2937;background:#fff">
    <div style="font-size:20px;font-weight:700;color:#0f172a">DocPats</div>
    <div style="font-size:14px;color:#64748b;margin-top:2px">${t.hi}</div>
    ${section(t.articles, articles.map(article).join(""))}
    ${section(t.confs, conferences.map(conf).join(""))}
    <div style="margin-top:30px;padding-top:16px;border-top:1px solid #e6eaf0;font-size:12px;color:#94a3b8">
      <a href="${unsubUrl}" style="color:#94a3b8">${t.unsub}</a>
    </div>
  </div>`;
}

export async function runNewsletterWeekly({ dryRun = false } = {}) {
  const recipients = await NewsletterSubscriber.find({
    confirmedAt: { $ne: null },
    unsubscribedAt: null,
  })
    .limit(5000)
    .lean();

  if (!recipients.length) {
    log.info("Подписчиков нет — рассылка пропущена");
    return { sent: 0, total: 0 };
  }

  // Материалы одинаковы в пределах языка и аудитории — собираем их один
  // раз, а не на каждого подписчика.
  const cache = new Map();
  const contentFor = async (locale, audience) => {
    const key = `${locale}:${audience}`;
    if (!cache.has(key)) {
      cache.set(key, {
        articles: await latestArticles(locale),
        // Конференции — только врачам: пациенту они не нужны.
        conferences:
          audience === "doctor" ? await upcomingConferences(locale) : [],
      });
    }
    return cache.get(key);
  };

  let sent = 0;
  for (const sub of recipients) {
    try {
      const locale = L[sub.locale] ? sub.locale : "ru";
      const { articles, conferences } = await contentFor(locale, sub.audience);
      if (!articles.length && !conferences.length) continue;

      // Адрес расшифровывается только здесь и только для отправки.
      const doc = await NewsletterSubscriber.findById(sub._id);
      const email = doc?.email;
      if (!email) continue;

      // Отписка по идентификатору записи: у гостя нет учётной записи, и
      // привязать ссылку больше не к чему.
      const unsubUrl = unsubscribeUrl(String(sub._id), "newsletter");
      const t = L[locale];

      if (!dryRun) {
        await sendEmail([email], t.subject, t.hi, {
          html: buildHtml({ locale, articles, conferences, unsubUrl }),
          unsubscribeUrl: unsubUrl,
        });
        await NewsletterSubscriber.updateOne(
          { _id: sub._id },
          { $set: { lastSentAt: new Date() } },
        );
      }
      sent += 1;
    } catch (err) {
      // Один плохой адрес не останавливает рассылку.
      log.error({ err: err.message }, "Письмо не отправлено");
    }
  }

  log.info({ sent, total: recipients.length, dryRun }, "Рассылка завершена");
  return { sent, total: recipients.length };
}

export function startNewsletterWeeklyJob() {
  if (process.env.NEWSLETTER_WEEKLY === "off") {
    log.info("Еженедельная рассылка выключена (NEWSLETTER_WEEKLY=off)");
    return;
  }
  cron.schedule(CRON, async () => {
    try {
      await runNewsletterWeekly();
    } catch (err) {
      log.error({ err: err.message }, "Рассылка упала");
    }
  });
  log.info({ schedule: CRON }, "Еженедельная рассылка: cron активен");
}

export default startNewsletterWeeklyJob;
