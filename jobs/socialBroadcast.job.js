// server/jobs/socialBroadcast.job.js
// ─────────────────────────────────────────────────────────────────────
//   Публикация свежих материалов в собственный Telegram-канал.
//
//   Раз в 30 минут берём то, что опубликовано и ещё не постилось, и
//   отправляем не больше MAX_PER_RUN штук. Ограничение не техническое:
//   канал, куда за раз падает двадцать постов, читатели отключают.
//
//   Материалы старше MAX_AGE_HOURS не постим вообще. Иначе первый же
//   запуск вывалил бы в канал весь архив — а он у новостного движка
//   исчисляется тысячами.
//
//   Выключено, пока не заданы TELEGRAM_BOT_TOKEN и TELEGRAM_CHANNEL_ID.
// ─────────────────────────────────────────────────────────────────────

import cron from "node-cron";
import mongoose from "mongoose";
import SocialPost from "../common/models/Social/socialPost.js";
import {
  sendToChannel,
  telegramEnabled,
  escapeHtml,
} from "../common/social/telegram.service.js";

const CHANNEL = "telegram";
const MAX_PER_RUN = 3;
const MAX_AGE_HOURS = 48;
const CRON = process.env.SOCIAL_BROADCAST_CRON || "*/30 * * * *";

const FRONTEND_URL = process.env.FRONTEND_URL || "https://docpats.com";
const NEWS_DB_NAME = process.env.NEWS_DB_NAME || "DOCPATS_AI_NEWS";

function newsDb() {
  return mongoose.connection.getClient().db(NEWS_DB_NAME);
}

function plainText(s, limit = 280) {
  return String(s || "")
    .replace(/#+\s/g, "")
    .replace(/[*_`>[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

/** Свежие опубликованные новости — кандидаты на постинг. */
async function fetchCandidates() {
  const since = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000);
  try {
    const items = await newsDb()
      .collection("news")
      .find(
        {
          status: "published",
          slug: { $exists: true, $ne: null },
          publishedAt: { $gte: since },
        },
        {
          projection: {
            slug: 1,
            title: 1,
            summary: 1,
            aiSummaryShort: 1,
            publishedAt: 1,
          },
        },
      )
      // От старых к новым: канал должен читаться в хронологическом
      // порядке, а не задом наперёд.
      .sort({ publishedAt: 1 })
      .limit(MAX_PER_RUN * 10)
      .toArray();

    return items.map((n) => ({
      url: `${FRONTEND_URL}/news/${encodeURIComponent(n.slug)}`,
      title: n.title || "",
      summary: n.aiSummaryShort || n.summary || "",
    }));
  } catch (err) {
    console.error("[social] fetchCandidates:", err.message);
    return [];
  }
}

function composePost({ title, summary, url }) {
  const parts = [`<b>${escapeHtml(plainText(title, 200))}</b>`];
  const body = plainText(summary);
  if (body) parts.push(escapeHtml(body));
  parts.push(escapeHtml(url));
  return parts.join("\n\n");
}

export async function runSocialBroadcast() {
  if (!telegramEnabled()) return { skipped: "disabled" };

  const candidates = await fetchCandidates();
  if (candidates.length === 0) return { candidates: 0, posted: 0 };

  const posted = new Set(
    (
      await SocialPost.find(
        { channel: CHANNEL, refUrl: { $in: candidates.map((c) => c.url) } },
        { refUrl: 1 },
      ).lean()
    ).map((d) => d.refUrl),
  );

  const fresh = candidates.filter((c) => c.url && !posted.has(c.url));
  let sent = 0;

  for (const item of fresh.slice(0, MAX_PER_RUN)) {
    const ok = await sendToChannel(composePost(item));
    if (!ok) break; // канал недоступен — остальные попробуем в следующий раз

    // Отметку ставим ТОЛЬКО после успешной отправки: иначе неотправленный
    // материал считался бы опубликованным и не ушёл бы уже никогда.
    try {
      await SocialPost.create({
        channel: CHANNEL,
        refUrl: item.url,
        title: item.title.slice(0, 300),
      });
    } catch (err) {
      // Гонка двух процессов на уникальном индексе — не ошибка:
      // значит кто-то опубликовал этот материал прямо сейчас.
      if (err?.code !== 11000) throw err;
    }
    sent += 1;
  }

  return { candidates: candidates.length, fresh: fresh.length, posted: sent };
}

/** Регистрация cron — каждые 30 минут. */
export function scheduleSocialBroadcast() {
  if (!telegramEnabled()) {
    console.log(
      "ℹ️ Автопостинг в Telegram выключен (нет TELEGRAM_BOT_TOKEN / TELEGRAM_CHANNEL_ID)",
    );
    return;
  }

  cron.schedule(CRON, async () => {
    try {
      const r = await runSocialBroadcast();
      if (r.skipped) return;
      if (r.posted > 0) {
        console.log(
          `📣 Telegram: кандидатов=${r.candidates} новых=${r.fresh} отправлено=${r.posted}`,
        );
      }
    } catch (err) {
      console.error("❌ Social broadcast cron error:", err.message);
    }
  });
  console.log(`⏰ Автопостинг в Telegram активен (${CRON})`);
}

export default scheduleSocialBroadcast;
