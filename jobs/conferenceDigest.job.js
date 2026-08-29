// server/jobs/conferenceDigest.job.js
// ─────────────────────────────────────────────────────────────────────
//   Еженедельная подборка предстоящих конференций — врачам, на почту и
//   в колокольчик.
//
//   ЧТО В ПИСЬМЕ. Ровно столько, чтобы за пять секунд решить «моё / не
//   моё»: название, даты, место, формат, дедлайн. Программа, спикеры,
//   цены и регистрация — на карточке. Прятать при этом сами даты ради
//   лишнего клика нельзя: приём с интригой поднимает открытия на первых
//   письмах и роняет доверие на третьем, а человек, кликнувший впустую
//   дважды, жмёт «спам». Цена такой жалобы здесь выше обычной — она
//   бьёт по доставляемости писем о приёмах.
//
//   БЕЗ СЕГМЕНТАЦИИ ПО СПЕЦИАЛЬНОСТИ НА СТАРТЕ. Жёсткий фильтр «строго
//   моя специальность» ощущается как поломка: врач видит конференцию на
//   сайте и не получает её в письме. Пограничные темы — норма
//   (кардиоонкология, диабет, визуализация, ИИ в медицине), а поле
//   ProfileDoctor.specialty к тому же заполнено не у всех. Поэтому по
//   умолчанию шлём всё, а сузить список врач может сам —
//   User.conferenceCategories.
//
//   Сортировка на релевантность: сначала своя страна, потом онлайн,
//   потом остальное. География попадает точнее темы — врач из Баку не
//   полетит в Чикаго за свой счёт.
//
//   Анти-спам: одно письмо в неделю, не чаще COOLDOWN_DAYS, только тем,
//   кто не отписался, и одна конференция одному врачу не повторяется.
// ─────────────────────────────────────────────────────────────────────

import cron from "node-cron";
import mongoose from "mongoose";
import User from "../common/models/Auth/users.js";
import ProfileDoctor from "../common/models/DoctorProfile/profileDoctor.js";
import Notification from "../common/models/Notification/notification.js";
import { sendEmail } from "../common/services/emailService.js";
import { unsubscribeUrl } from "../common/services/unsubscribeToken.js";
import { notify } from "../modules/notifications/services/notification.service.js";

const DAY = 24 * 60 * 60 * 1000;
const COOLDOWN_DAYS = 6; // раз в неделю, с запасом на сдвиг крона
const DEADLINE_SOON_DAYS = 14; // «регистрация закрывается» — второй повод письма
const MAX_ITEMS_PER_EMAIL = 8;
const MAX_BATCH = 500; // предохранитель на один прогон
const REPEAT_WINDOW_DAYS = 60; // столько помним, что уже слали

const FRONTEND_URL = process.env.FRONTEND_URL || "https://docpats.com";
const NEWS_DB_NAME = process.env.NEWS_DB_NAME || "DOCPATS_AI_NEWS";
const CRON = process.env.CONFERENCE_DIGEST_CRON || "0 9 * * 1"; // понедельник, 09:00 UTC

// Конференции живут в базе новостного движка — той же, откуда socialBroadcast
// берёт материалы для канала. Отдельного HTTP-вызова не нужно: кластер один.
function newsDb() {
  return mongoose.connection.getClient().db(NEWS_DB_NAME);
}

const LOCALE_TAG = { ru: "ru-RU", en: "en-US", az: "az-AZ", tr: "tr-TR", ar: "ar" };

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const TEXT = {
  ru: {
    subject: (n) => `Предстоящие конференции: ${n} ${plural(n, "событие", "события", "событий")}`,
    hello: (name) => `Здравствуйте${name}!`,
    intro: "Подборка предстоящих медицинских конференций:",
    deadline: "регистрация до",
    abstract: "тезисы до",
    online: "онлайн",
    hybrid: "очно и онлайн",
    more: (url) => `Все конференции с фильтрами по стране, теме и дате: ${url}`,
    bellTitle: (n) => `${n} ${plural(n, "новая конференция", "новые конференции", "новых конференций")}`,
  },
  en: {
    subject: (n) => `Upcoming conferences: ${n} event${n === 1 ? "" : "s"}`,
    hello: (name) => `Hello${name}!`,
    intro: "Upcoming medical conferences:",
    deadline: "register by",
    abstract: "abstracts by",
    online: "online",
    hybrid: "on-site and online",
    more: (url) => `All conferences, filtered by country, topic and date: ${url}`,
    bellTitle: (n) => `${n} new conference${n === 1 ? "" : "s"}`,
  },
  az: {
    subject: (n) => `Qarşıdan gələn konfranslar: ${n}`,
    hello: (name) => `Salam${name}!`,
    intro: "Qarşıdan gələn tibbi konfranslar:",
    deadline: "qeydiyyat son tarixi",
    abstract: "tezislər üçün son tarix",
    online: "onlayn",
    hybrid: "əyani və onlayn",
    more: (url) => `Ölkə, mövzu və tarix üzrə bütün konfranslar: ${url}`,
    bellTitle: (n) => `${n} yeni konfrans`,
  },
  tr: {
    subject: (n) => `Yaklaşan kongreler: ${n}`,
    hello: (name) => `Merhaba${name}!`,
    intro: "Yaklaşan tıbbi kongreler:",
    deadline: "son kayıt",
    abstract: "bildiri son tarihi",
    online: "çevrimiçi",
    hybrid: "yüz yüze ve çevrimiçi",
    more: (url) => `Ülke, konu ve tarihe göre tüm kongreler: ${url}`,
    bellTitle: (n) => `${n} yeni kongre`,
  },
  ar: {
    subject: (n) => `المؤتمرات القادمة: ${n}`,
    hello: (name) => `مرحباً${name}!`,
    intro: "المؤتمرات الطبية القادمة:",
    deadline: "التسجيل حتى",
    abstract: "الملخصات حتى",
    online: "عبر الإنترنت",
    hybrid: "حضورياً وعبر الإنترنت",
    more: (url) => `كل المؤتمرات مع التصفية حسب البلد والموضوع والتاريخ: ${url}`,
    bellTitle: (n) => `${n} مؤتمرات جديدة`,
  },
};

function dict(lang) {
  return TEXT[lang] || TEXT.ru;
}

function formatDate(date, lang) {
  if (!date) return "";
  try {
    return new Intl.DateTimeFormat(LOCALE_TAG[lang] || "ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(date));
  } catch {
    return new Date(date).toISOString().slice(0, 10);
  }
}

/**
 * Подходит ли конференция врачу.
 * Пустой список интересов у врача = интересно всё. Пустые категории у
 * конференции = тема вне специальностей (право, ИИ, управление), она нужна
 * всем и не должна отсеиваться фильтром.
 */
export function matchesDoctor(conference, { categories = [] } = {}) {
  if (!categories.length) return true;
  const own = conference.categories || [];
  if (!own.length) return true;
  return own.some((c) => categories.includes(c));
}

/** Своя страна → онлайн/гибрид → остальное; внутри группы — по дедлайну. */
export function rankForDoctor(items, { country = "" } = {}) {
  const weight = (c) => {
    if (country && c.country && c.country.toLowerCase() === country.toLowerCase()) return 0;
    if (c.format === "online" || c.format === "hybrid") return 1;
    return 2;
  };
  return [...items].sort((a, b) => {
    const w = weight(a) - weight(b);
    if (w !== 0) return w;
    const da = a.registrationDeadline || a.startDate || 0;
    const db = b.registrationDeadline || b.startDate || 0;
    return new Date(da) - new Date(db);
  });
}

/**
 * Что вообще есть смысл рассылать на этой неделе: опубликованное,
 * непрошедшее, и либо появившееся с прошлой рассылки, либо с дедлайном на
 * носу. Второе — то, ради чего рубрика существует: дату начала врач и так
 * увидит, а дедлайн подачи тезисов пропускается легко.
 */
export async function fetchDigestPool(now = new Date()) {
  const since = new Date(now.getTime() - (COOLDOWN_DAYS + 1) * DAY);
  const deadlineBefore = new Date(now.getTime() + DEADLINE_SOON_DAYS * DAY);

  return newsDb()
    .collection("conferences")
    .find({
      status: "published",
      $and: [
        {
          $or: [
            { endDate: { $gte: now } },
            { endDate: null, startDate: { $gte: now } },
          ],
        },
        {
          $or: [
            { createdAt: { $gte: since } },
            { registrationDeadline: { $gte: now, $lte: deadlineBefore } },
            { abstractDeadline: { $gte: now, $lte: deadlineBefore } },
          ],
        },
      ],
    })
    .limit(200)
    .toArray();
}

/** Врачи, которым сейчас можно писать. Вынесено отдельно для тестов. */
export async function selectConferenceRecipients(now = new Date()) {
  const cooldownBefore = new Date(now.getTime() - COOLDOWN_DAYS * DAY);

  const users = await User.find({
    role: "doctor",
    isDeleted: { $ne: true },
    conferenceDigestEnabled: { $ne: false },
    $or: [
      { lastConferenceEmailAt: null },
      { lastConferenceEmailAt: { $exists: false } },
      { lastConferenceEmailAt: { $lt: cooldownBefore } },
    ],
  })
    .select(
      "_id username preferredLanguage conferenceCategories emailEncrypted firstNameEncrypted lastConferenceEmailAt",
    )
    .limit(MAX_BATCH);

  if (!users.length) return [];

  // Страна врача лежит в профиле, не в User. Забираем одним запросом.
  const profiles = await ProfileDoctor.find({ userId: { $in: users.map((u) => u._id) } })
    .select("userId country")
    .lean();
  const countryByUser = new Map(profiles.map((p) => [String(p.userId), p.country || ""]));

  return users.map((user) => ({
    user,
    country: countryByUser.get(String(user._id)) || "",
  }));
}

/** Что этому врачу уже присылали — чтобы не слать второй раз. */
async function alreadySentSlugs(userId, now) {
  const since = new Date(now.getTime() - REPEAT_WINDOW_DAYS * DAY);
  const sent = await Notification.find({
    userId,
    type: "conference_announced",
    createdAt: { $gte: since },
  })
    .select("meta")
    .lean();

  const slugs = new Set();
  for (const n of sent) {
    for (const slug of n.meta?.slugs || []) slugs.add(slug);
  }
  return slugs;
}

export function buildDigestEmail({ lang, firstName, items }) {
  const t = dict(lang);
  const name = firstName ? ` ${firstName}` : "";

  const lines = items.map((c) => {
    const when =
      c.endDate && String(c.endDate) !== String(c.startDate)
        ? `${formatDate(c.startDate, lang)} — ${formatDate(c.endDate, lang)}`
        : formatDate(c.startDate, lang);

    const where =
      c.format === "online"
        ? t.online
        : [c.city, c.country].filter(Boolean).join(", ") +
          (c.format === "hybrid" ? ` (${t.hybrid})` : "");

    const deadline = c.registrationDeadline
      ? `\n   ${t.deadline} ${formatDate(c.registrationDeadline, lang)}`
      : c.abstractDeadline
        ? `\n   ${t.abstract} ${formatDate(c.abstractDeadline, lang)}`
        : "";

    // Ссылка ведёт на карточку конкретной конференции, а не в общий список:
    // человек должен попадать туда, где уже есть ответ.
    return `• ${c.title}\n   ${[when, where].filter(Boolean).join(" · ")}${deadline}\n   ${FRONTEND_URL}/conferences/${c.slug}`;
  });

  const body = [
    t.hello(name),
    "",
    t.intro,
    "",
    lines.join("\n\n"),
    "",
    t.more(`${FRONTEND_URL}/conferences`),
  ].join("\n");

  return { subject: t.subject(items.length), body };
}

/** Прогон рассылки. */
export async function runConferenceDigest(now = new Date()) {
  const pool = await fetchDigestPool(now);
  if (!pool.length) return { pool: 0, candidates: 0, sent: 0, errors: 0, skipped: 0 };

  const recipients = await selectConferenceRecipients(now);
  let sent = 0;
  let errors = 0;
  let skipped = 0;

  for (const { user, country } of recipients) {
    try {
      const categories = user.conferenceCategories || [];
      const seen = await alreadySentSlugs(user._id, now);

      const items = rankForDoctor(
        pool.filter((c) => matchesDoctor(c, { categories }) && !seen.has(c.slug)),
        { country },
      ).slice(0, MAX_ITEMS_PER_EMAIL);

      if (!items.length) {
        skipped += 1;
        continue;
      }

      const lang = user.preferredLanguage || "ru";
      const t = dict(lang);

      let emailPlain = null;
      let firstName = "";
      if (typeof user.decryptFields === "function") {
        const f = user.decryptFields();
        emailPlain = f.email;
        firstName = f.firstName || "";
      }

      // Колокольчик — одним уведомлением на подборку, а не по штуке на
      // конференцию: колокольчик, куда за раз падает восемь записей,
      // перестают открывать. Здесь же остаётся память о том, что уже
      // отправлено (meta.slugs).
      await notify({
        userId: user._id,
        type: "conference_announced",
        title: items.length === 1 ? items[0].title : t.bellTitle(items.length),
        message: t.intro,
        link: items.length === 1 ? `/conferences/${items[0].slug}` : "/conferences",
        meta: { slugs: items.map((c) => c.slug) },
        icon: "calendar",
      });

      // Отмечаем всегда — анти-спам важнее одной пропущенной отправки.
      await User.updateOne({ _id: user._id }, { $set: { lastConferenceEmailAt: now } });

      if (!emailPlain) continue;

      const { subject, body } = buildDigestEmail({ lang, firstName, items });
      const ok = await sendEmail(emailPlain, subject, body, {
        unsubscribeUrl: unsubscribeUrl(String(user._id), "conference"),
      });
      if (ok) sent += 1;
      else errors += 1;
    } catch (e) {
      errors += 1;
      console.error("conferenceDigest error for user", String(user._id), e.message);
    }
  }

  return { pool: pool.length, candidates: recipients.length, sent, errors, skipped };
}

/** Регистрация крона — по умолчанию понедельник, 09:00 UTC. */
export function scheduleConferenceDigest() {
  cron.schedule(CRON, async () => {
    try {
      const r = await runConferenceDigest();
      console.log(
        `📅 Conference digest: pool=${r.pool} candidates=${r.candidates} sent=${r.sent} errors=${r.errors}`,
      );
    } catch (err) {
      console.error("❌ Conference digest error:", err.message);
    }
  });
}

export default { runConferenceDigest, scheduleConferenceDigest };
