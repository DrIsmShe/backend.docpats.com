// =====================================================================
// common/sitemap/services/sitemap.service.js
// =====================================================================

import mongoose from "mongoose";
import axios from "axios";

const isProduction = process.env.NODE_ENV === "production";

// В проде: FRONTEND_URL=https://docpats.com (уже есть в .env)
const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  (isProduction ? "https://docpats.com" : "http://localhost:3000");

// В проде: https://news-api.docpats.com (видно из edge function)
const NEWS_ENGINE_URL =
  process.env.NEWS_ENGINE_URL ||
  (isProduction ? "https://news-api.docpats.com" : "http://localhost:5010");

const LANGS = ["ru", "en", "az", "tr", "ar"];

// Кэш 1 час
let cache = { xml: null, builtAt: 0 };
const CACHE_TTL_MS = 60 * 60 * 1000;

// ─── Статические страницы ─────────────────────────────────────────────
// Язык через localStorage — один URL для всех языков
const STATIC_PAGES = [
  { path: "/", priority: "1.0", changefreq: "daily" },
  { path: "/about", priority: "0.6", changefreq: "monthly" },
  { path: "/articles", priority: "0.9", changefreq: "daily" },
  { path: "/news", priority: "0.9", changefreq: "hourly" },
  { path: "/consultation", priority: "0.7", changefreq: "monthly" },
  { path: "/pricing", priority: "0.6", changefreq: "monthly" },
  { path: "/demo", priority: "0.5", changefreq: "monthly" },
];

// ─── HELPERS ─────────────────────────────────────────────────────────
function escapeXml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toW3cDate(date) {
  try {
    return new Date(date).toISOString().split("T")[0];
  } catch {
    return new Date().toISOString().split("T")[0];
  }
}

// Одна запись с hreflang — для страниц где язык НЕ в URL (localStorage/cookie)
// Все языки указывают на один и тот же URL
function urlWithHreflang({ loc, lastmod, changefreq, priority }) {
  const hreflangTags = LANGS.map(
    (lang) =>
      `    <xhtml:link rel="alternate" hreflang="${lang}" href="${escapeXml(loc)}"/>`,
  ).join("\n");

  return `  <url>
    <loc>${escapeXml(loc)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(loc)}"/>
${hreflangTags}
  </url>`;
}

// 6 записей для синтез-статей — базовый URL + /ru /en /az /tr /ar
// Язык ЕСТЬ в URL: /articles/:id/:lang
function urlEntriesForSynthesisArticle({ baseUrl, lastmod }) {
  const entries = [];

  // Базовый URL (x-default) — без языка
  const baseHreflang = [
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(baseUrl)}"/>`,
    ...LANGS.map(
      (l) =>
        `    <xhtml:link rel="alternate" hreflang="${l}" href="${escapeXml(`${baseUrl}/${l}`)}"/>`,
    ),
  ].join("\n");

  entries.push(`  <url>
    <loc>${escapeXml(baseUrl)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
${baseHreflang}
  </url>`);

  // Одна запись для каждого языка
  for (const lang of LANGS) {
    const langUrl = `${baseUrl}/${lang}`;
    const langHreflang = [
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(baseUrl)}"/>`,
      ...LANGS.map(
        (l) =>
          `    <xhtml:link rel="alternate" hreflang="${l}" href="${escapeXml(`${baseUrl}/${l}`)}"/>`,
      ),
    ].join("\n");

    entries.push(`  <url>
    <loc>${escapeXml(langUrl)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
${langHreflang}
  </url>`);
  }

  return entries.join("\n");
}

// ─── FETCHERS ────────────────────────────────────────────────────────

// /public/doctor-profile/doctor-details/:id
// Язык через localStorage — один URL + hreflang
async function fetchDoctors() {
  try {
    const db = mongoose.connection.db;
    const doctors = await db
      .collection("users")
      .find(
        { isDoctor: true, isBlocked: { $ne: true } },
        { projection: { _id: 1, updatedAt: 1 } },
      )
      .toArray();

    return doctors.map((d) =>
      urlWithHreflang({
        loc: `${FRONTEND_URL}/public/doctor-profile/doctor-details/${d._id}`,
        lastmod: toW3cDate(d.updatedAt),
        changefreq: "weekly",
        priority: "0.8",
      }),
    );
  } catch (err) {
    console.error("[sitemap] fetchDoctors:", err.message);
    return [];
  }
}

// /news/:slug
// Язык через ?locale= query param — НЕ в path
// Один URL + hreflang (все языки на один URL)
async function fetchNews() {
  try {
    const { data } = await axios.get(`${NEWS_ENGINE_URL}/api/news`, {
      params: { limit: 5000 },
      timeout: 8000,
    });
    const items = data?.items || data?.news || data?.data || [];

    return items
      .filter((n) => n.slug || n._id)
      .map((n) =>
        urlWithHreflang({
          loc: `${FRONTEND_URL}/news/${encodeURIComponent(n.slug || n._id)}`,
          lastmod: toW3cDate(n.updatedAt || n.publishedAt),
          changefreq: "weekly",
          priority: "0.7",
        }),
      );
  } catch (err) {
    console.error("[sitemap] fetchNews:", err.message);
    return [];
  }
}

// /articles/:id  +  /articles/:id/ru  /en  /az  /tr  /ar
// Язык ЕСТЬ в URL — генерируем 6 записей на статью
async function fetchSynthesisArticles() {
  try {
    const { data } = await axios.get(`${NEWS_ENGINE_URL}/api/synthesis`, {
      params: { limit: 2000 },
      timeout: 8000,
    });
    const items = data?.items || data?.articles || data?.data || [];

    return items
      .filter((a) => a._id)
      .map((a) =>
        urlEntriesForSynthesisArticle({
          baseUrl: `${FRONTEND_URL}/articles/${a._id}`,
          lastmod: toW3cDate(a.updatedAt || a.createdAt),
        }),
      );
  } catch (err) {
    console.error("[sitemap] fetchSynthesisArticles:", err.message);
    return [];
  }
}

// /public/doctor-profile/article-detail-for-all/:id
// Язык через i18n (localStorage) — один URL + hreflang
async function fetchDoctorArticles() {
  try {
    const db = mongoose.connection.db;
    // ⚠️ Проверь реальное название коллекции в MongoDB Compass
    const articles = await db
      .collection("Article")
      .find({ isPublished: true }, { projection: { _id: 1, updatedAt: 1 } })
      .toArray();

    return articles.map((a) =>
      urlWithHreflang({
        loc: `${FRONTEND_URL}/public/doctor-profile/article-detail-for-all/${a._id}`,
        lastmod: toW3cDate(a.updatedAt),
        changefreq: "monthly",
        priority: "0.65",
      }),
    );
  } catch (err) {
    // Коллекция может называться иначе — не падаем
    console.error("[sitemap] fetchDoctorArticles:", err.message);
    return [];
  }
}

// /public/doctor/article-scientific-detail-for-all/:id
// Язык через i18n (localStorage) — один URL + hreflang
async function fetchScientificArticles() {
  try {
    const db = mongoose.connection.db;
    // ⚠️ Проверь реальное название коллекции в MongoDB Compass
    const articles = await db
      .collection("ArticleScine")
      .find({ isPublished: true }, { projection: { _id: 1, updatedAt: 1 } })
      .toArray();

    return articles.map((a) =>
      urlWithHreflang({
        loc: `${FRONTEND_URL}/public/doctor/article-scientific-detail-for-all/${a._id}`,
        lastmod: toW3cDate(a.updatedAt),
        changefreq: "monthly",
        priority: "0.65",
      }),
    );
  } catch (err) {
    console.error("[sitemap] fetchScientificArticles:", err.message);
    return [];
  }
}

// ─── BUILD ────────────────────────────────────────────────────────────
async function buildSitemapXml() {
  const [doctors, news, synthesis, doctorArticles, scientificArticles] =
    await Promise.all([
      fetchDoctors(),
      fetchNews(),
      fetchSynthesisArticles(),
      fetchDoctorArticles(),
      fetchScientificArticles(),
    ]);

  const staticEntries = STATIC_PAGES.map((p) =>
    urlWithHreflang({
      loc: `${FRONTEND_URL}${p.path}`,
      lastmod: toW3cDate(new Date()),
      changefreq: p.changefreq,
      priority: p.priority,
    }),
  );

  // synthesis уже возвращает строки с XML
  const allEntries = [
    ...staticEntries,
    ...doctors,
    ...news,
    ...synthesis,
    ...doctorArticles,
    ...scientificArticles,
  ];

  console.log(
    `[sitemap] Built: ${allEntries.length} entries` +
      ` | doctors: ${doctors.length}` +
      ` | news: ${news.length}` +
      ` | synthesis: ${synthesis.length} (×6 langs)` +
      ` | doctor-articles: ${doctorArticles.length}` +
      ` | scientific: ${scientificArticles.length}`,
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset
  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="
    http://www.sitemaps.org/schemas/sitemap/0.9
    http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
${allEntries.join("\n")}
</urlset>`;
}

// ─── CONTROLLERS ─────────────────────────────────────────────────────
export async function generateSitemap(req, res) {
  try {
    const now = Date.now();
    if (cache.xml && now - cache.builtAt < CACHE_TTL_MS) {
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("X-Sitemap-Cache", "HIT");
      return res.send(cache.xml);
    }

    const xml = await buildSitemapXml();
    cache = { xml, builtAt: now };

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("X-Sitemap-Cache", "MISS");
    return res.send(xml);
  } catch (err) {
    console.error("[sitemap] error:", err);
    res.status(500).json({ error: "Sitemap generation failed" });
  }
}

export function generateRobots(req, res) {
  const txt = `User-agent: *
Allow: /

# Закрытые зоны — требуют авторизации
Disallow: /dp/
Disallow: /patient/
Disallow: /doctor/
Disallow: /admin/
Disallow: /api/

# Auth страницы
Disallow: /login
Disallow: /registration
Disallow: /resetpassword
Disallow: /confirmationregister
Disallow: /resetpasswordchange
Disallow: /otpresetpasswordchange

Sitemap: ${FRONTEND_URL}/sitemap.xml
`;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400");
  return res.send(txt);
}

export function invalidateSitemapCache() {
  cache = { xml: null, builtAt: 0 };
  console.log("[sitemap] Cache invalidated");
}
