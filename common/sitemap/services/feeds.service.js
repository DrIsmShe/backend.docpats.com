// common/sitemap/services/feeds.service.js
//
// Два канала распространения, которых у платформы не было вовсе:
//
//   /rss.xml          — обычный RSS 2.0. Его читают агрегаторы, Feedly,
//                       Telegram-боты, сервисы вида RSS→соцсеть. Один
//                       файл заменяет десяток ручных постингов: канал
//                       забирает новое сам.
//   /news-sitemap.xml — sitemap формата Google News. Отдельный формат и
//                       отдельный файл, потому что Google News смотрит
//                       ТОЛЬКО материалы за последние 48 часов и требует
//                       блок <news:news> с датой и языком. Обычный
//                       sitemap для этого не годится: он про весь сайт и
//                       без новостных полей.
//
// Данные — из той же базы новостного движка, что и sitemap: news-engine
// пишет туда напрямую, у него отдельный процесс и своя коллекция.
// Читаем из Mongo, а не через HTTP-API, по той же причине, что и sitemap:
// список у news-api пагинирован, и часть материалов молча терялась бы.

import mongoose from "mongoose";

const isProduction = process.env.NODE_ENV === "production";

const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  (isProduction ? "https://docpats.com" : "http://localhost:3000");

const NEWS_DB_NAME = process.env.NEWS_DB_NAME || "DOCPATS_AI_NEWS";

const SITE_NAME = "DocPats";

// Сколько материалов отдаём в RSS. Больше 50 не нужно: читалки берут
// свежее, а тяжёлый фид они же и обрезают.
const RSS_LIMIT = 50;

// Окно Google News. Двое суток — не наше решение, это их правило:
// материалы старше в news-sitemap не принимаются.
const NEWS_WINDOW_MS = 48 * 60 * 60 * 1000;
const NEWS_SITEMAP_LIMIT = 1000;

const RSS_CACHE_TTL_MS = 15 * 60 * 1000;
const NEWS_CACHE_TTL_MS = 10 * 60 * 1000;

let rssCache = { xml: null, builtAt: 0 };
let newsCache = { xml: null, builtAt: 0 };

// ─── HELPERS ─────────────────────────────────────────────────────────

function escapeXml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** RSS требует RFC-822, а не ISO. */
function toRfc822(date) {
  try {
    return new Date(date).toUTCString();
  } catch {
    return new Date().toUTCString();
  }
}

function toIso(date) {
  try {
    return new Date(date).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function plainText(s, limit = 300) {
  return String(s || "")
    .replace(/#+\s/g, "")
    .replace(/[*_`>[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function newsDb() {
  return mongoose.connection.getClient().db(NEWS_DB_NAME);
}

function collectionOf(modelName, fallback) {
  return mongoose.models[modelName]?.collection?.collectionName || fallback;
}

// ─── FETCHERS ────────────────────────────────────────────────────────

async function fetchRecentNews(limit, since = null) {
  try {
    const query = {
      status: "published",
      slug: { $exists: true, $ne: null },
    };
    if (since) query.publishedAt = { $gte: since };

    return await newsDb()
      .collection("news")
      .find(query, {
        projection: {
          slug: 1,
          title: 1,
          summary: 1,
          aiSummaryShort: 1,
          imageUrl: 1,
          language: 1,
          publishedAt: 1,
          createdAt: 1,
        },
      })
      .sort({ publishedAt: -1, createdAt: -1 })
      .limit(limit)
      .toArray();
  } catch (err) {
    console.error("[feeds] fetchRecentNews:", err.message);
    return [];
  }
}

async function fetchRecentSynthesis(limit) {
  try {
    return await newsDb()
      .collection(collectionOf("Synthesis", "syntheses"))
      .find(
        { status: "published" },
        {
          projection: {
            _id: 1,
            title: 1,
            body: 1,
            seo: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      )
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  } catch (err) {
    console.error("[feeds] fetchRecentSynthesis:", err.message);
    return [];
  }
}

// ─── RSS 2.0 ─────────────────────────────────────────────────────────

function rssItem({ title, link, description, pubDate, guid, image }) {
  const enclosure = image
    ? `\n      <enclosure url="${escapeXml(image)}" type="image/jpeg"/>`
    : "";
  return `    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(guid || link)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escapeXml(description)}</description>${enclosure}
    </item>`;
}

async function buildRssXml() {
  const [news, synthesis] = await Promise.all([
    fetchRecentNews(RSS_LIMIT),
    fetchRecentSynthesis(RSS_LIMIT),
  ]);

  const items = [
    ...news.map((n) => ({
      date: n.publishedAt || n.createdAt,
      xml: rssItem({
        title: n.title || "Untitled",
        link: `${FRONTEND_URL}/news/${encodeURIComponent(n.slug)}`,
        description: plainText(n.aiSummaryShort || n.summary),
        pubDate: toRfc822(n.publishedAt || n.createdAt),
        image: n.imageUrl,
      }),
    })),
    ...synthesis.map((a) => ({
      date: a.createdAt,
      xml: rssItem({
        title: a.seo?.ru?.title || a.title || "Untitled",
        link: `${FRONTEND_URL}/articles/${a._id}`,
        description: plainText(a.seo?.ru?.description || a.body),
        pubDate: toRfc822(a.createdAt),
      }),
    })),
  ]
    // Слитый список пересортировываем: две выборки по отдельности
    // отсортированы, вместе — нет, и в читалке порядок был бы рваный.
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, RSS_LIMIT);

  const now = toRfc822(new Date());

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${SITE_NAME} — медицинские новости и обзоры</title>
    <link>${escapeXml(FRONTEND_URL)}</link>
    <description>Новости доказательной медицины и аналитические обзоры платформы ${SITE_NAME}.</description>
    <language>ru</language>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="${escapeXml(FRONTEND_URL)}/rss.xml" rel="self" type="application/rss+xml"/>
${items.map((i) => i.xml).join("\n")}
  </channel>
</rss>`;
}

export async function generateRssFeed(req, res) {
  try {
    const now = Date.now();
    if (rssCache.xml && now - rssCache.builtAt < RSS_CACHE_TTL_MS) {
      res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
      res.setHeader("X-Feed-Cache", "HIT");
      return res.send(rssCache.xml);
    }

    const xml = await buildRssXml();
    rssCache = { xml, builtAt: now };

    res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=900");
    res.setHeader("X-Feed-Cache", "MISS");
    return res.send(xml);
  } catch (err) {
    console.error("[feeds] rss error:", err);
    return res.status(500).json({ error: "RSS generation failed" });
  }
}

// ─── Google News sitemap ─────────────────────────────────────────────

async function buildNewsSitemapXml() {
  const since = new Date(Date.now() - NEWS_WINDOW_MS);
  const items = await fetchRecentNews(NEWS_SITEMAP_LIMIT, since);

  const entries = items.map((n) => {
    // Язык обязателен и должен быть двухбуквенным кодом. У материала он
    // свой (движок размечает при импорте); пустое поле — "en", как и
    // дефолт модели.
    const lang = (n.language || "en").slice(0, 2).toLowerCase();
    return `  <url>
    <loc>${escapeXml(`${FRONTEND_URL}/news/${encodeURIComponent(n.slug)}`)}</loc>
    <news:news>
      <news:publication>
        <news:name>${SITE_NAME}</news:name>
        <news:language>${lang}</news:language>
      </news:publication>
      <news:publication_date>${toIso(n.publishedAt || n.createdAt)}</news:publication_date>
      <news:title>${escapeXml(n.title || "Untitled")}</news:title>
    </news:news>
  </url>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${entries.join("\n")}
</urlset>`;
}

export async function generateNewsSitemap(req, res) {
  try {
    const now = Date.now();
    if (newsCache.xml && now - newsCache.builtAt < NEWS_CACHE_TTL_MS) {
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("X-Feed-Cache", "HIT");
      return res.send(newsCache.xml);
    }

    const xml = await buildNewsSitemapXml();
    newsCache = { xml, builtAt: now };

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=600");
    res.setHeader("X-Feed-Cache", "MISS");
    return res.send(xml);
  } catch (err) {
    console.error("[feeds] news sitemap error:", err);
    return res.status(500).json({ error: "News sitemap generation failed" });
  }
}

export function invalidateFeedCaches() {
  rssCache = { xml: null, builtAt: 0 };
  newsCache = { xml: null, builtAt: 0 };
  console.log("[feeds] Caches invalidated");
}
