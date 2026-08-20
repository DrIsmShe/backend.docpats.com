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

// Новости и синтез-статьи лежат в отдельной базе того же Mongo-кластера
// (news-api их туда пишет). Читаем напрямую из Mongo, а не через HTTP-API:
// список у news-api пагинирован с потолком в 100 записей на страницу, из БД
// же берём всё разом.
const NEWS_DB_NAME = process.env.NEWS_DB_NAME || "DOCPATS_AI_NEWS";

const LANGS = ["ru", "en", "az", "tr", "ar"];

// Лимит протокола sitemap — 50 000 URL на файл. Упрёмся — понадобится
// sitemap index; до тех пор громко пишем в лог, а не молча теряем хвост.
const MAX_URLS = 50000;

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
  { path: "/top-doctors", priority: "0.8", changefreq: "weekly" },
  { path: "/demo", priority: "0.5", changefreq: "monthly" },
  { path: "/docs", priority: "0.7", changefreq: "weekly" },
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

// Имя коллекции спрашиваем у самой модели, а не пишем строкой руками.
// Прошлая версия угадывала ("Article" вместо "articles") — и статьи врачей
// молча не попадали в sitemap: find по несуществующей коллекции возвращает
// пустой массив, а не ошибку. Фолбэк — на случай, если модель ещё не
// зарегистрирована в этом процессе.
function collectionOf(modelName, fallback) {
  return mongoose.models[modelName]?.collection?.collectionName || fallback;
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
    const db = mongoose.connection.getClient().db(NEWS_DB_NAME);
    const items = await db
      .collection("news")
      .find(
        { status: "published", slug: { $exists: true, $ne: null } },
        { projection: { slug: 1, updatedAt: 1, publishedAt: 1 } },
      )
      .toArray();

    return items.map((n) =>
      urlWithHreflang({
        loc: `${FRONTEND_URL}/news/${encodeURIComponent(n.slug)}`,
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
// Язык ЕСТЬ в URL — генерируем 6 записей на статью.
//
// Читаем из Mongo, а не из GET /api/synthesis: та ручка отдаёт максимум
// MAX_PAGE_SIZE=100 записей за запрос, и прежний `limit: 2000` молча
// обрезался до сотни — в sitemap попадали только самые свежие статьи.
async function fetchSynthesisArticles() {
  try {
    const db = mongoose.connection.getClient().db(NEWS_DB_NAME);
    const items = await db
      .collection(collectionOf("Synthesis", "syntheses"))
      .find(
        { status: "published" },
        { projection: { _id: 1, updatedAt: 1, createdAt: 1 } },
      )
      .toArray();

    return items.map((a) =>
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
    const articles = await db
      .collection(collectionOf("Article", "articles"))
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
    console.error("[sitemap] fetchDoctorArticles:", err.message);
    return [];
  }
}

// /public/doctor/article-scientific-detail-for-all/:id
// Язык через i18n (localStorage) — один URL + hreflang
async function fetchScientificArticles() {
  try {
    const db = mongoose.connection.db;
    const articles = await db
      .collection(collectionOf("ArticleScine", "articlescines"))
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

// /docs/:section
// Корпус документации лежит статикой на фронте: public/docs/<раздел>/<язык>.md,
// а состав разделов — в public/docs/index.json (его собирает билд). Читаем
// манифест по HTTP: у сервера нет доступа к файлам фронта, а зашитый в код
// список разошёлся бы с корпусом при первом же новом разделе.
// Язык выбирается на клиенте — один URL на раздел + hreflang.
async function fetchDocsSections() {
  try {
    const { data } = await axios.get(`${FRONTEND_URL}/docs/index.json`, {
      timeout: 8000,
    });
    const sections = Array.isArray(data?.sections) ? data.sections : [];

    return sections
      .filter((s) => s?.name)
      .map((s) =>
        urlWithHreflang({
          loc: `${FRONTEND_URL}/docs/${encodeURIComponent(s.name)}`,
          lastmod: toW3cDate(data.generatedAt),
          changefreq: "monthly",
          priority: "0.7",
        }),
      );
  } catch (err) {
    console.error("[sitemap] fetchDocsSections:", err.message);
    return [];
  }
}

// ─── Витрины клиник ──────────────────────────────────────────────────
// Три уровня публичного контента клиники:
//   /clinics/:slug                                     — сама витрина
//   /clinics/:slug/dp/:pageSlug                        — раздел витрины
//   /clinics/:slug/dp/:pageSlug/articles/:articleSlug  — статья раздела
//
// Собираем одной функцией: слаг родителя нужен, чтобы построить URL потомка,
// поэтому идём сверху вниз и переиспользуем уже загруженные карты. Клиника
// скрыта → её разделы и статьи в sitemap не идут, даже если сами опубликованы.
async function fetchClinicUrls() {
  const empty = { clinics: [], pages: [], articles: [] };
  try {
    const db = mongoose.connection.db;

    const clinics = await db
      .collection(collectionOf("Clinic", "clinics"))
      .find(
        {
          isPublished: true,
          isActive: { $ne: false },
          isDeleted: { $ne: true },
          slug: { $exists: true, $ne: null },
        },
        { projection: { _id: 1, slug: 1, updatedAt: 1 } },
      )
      .toArray();

    if (clinics.length === 0) return empty;

    const clinicSlugById = new Map(clinics.map((c) => [String(c._id), c.slug]));

    const pages = await db
      .collection(collectionOf("ClinicCustomPage", "cliniccustompages"))
      .find(
        {
          status: "published",
          isDeleted: { $ne: true },
          clinicId: { $in: clinics.map((c) => c._id) },
        },
        { projection: { _id: 1, clinicId: 1, slug: 1, updatedAt: 1 } },
      )
      .toArray();

    // Статье нужен и слаг клиники, и слаг раздела — держим оба в одной карте.
    const pageById = new Map(
      pages.map((p) => [
        String(p._id),
        { clinicSlug: clinicSlugById.get(String(p.clinicId)), slug: p.slug },
      ]),
    );

    const articles = pages.length
      ? await db
          .collection(collectionOf("ClinicArticle", "clinicarticles"))
          .find(
            {
              status: "published",
              // moderation: "disabled" — рубильник проекта, статья скрыта
              // на витрине; в sitemap её быть не должно.
              moderation: { $ne: "disabled" },
              isDeleted: { $ne: true },
              pageId: { $in: pages.map((p) => p._id) },
            },
            { projection: { pageId: 1, slug: 1, updatedAt: 1 } },
          )
          .toArray()
      : [];

    const clinicEntries = clinics.map((c) =>
      urlWithHreflang({
        loc: `${FRONTEND_URL}/clinics/${encodeURIComponent(c.slug)}`,
        lastmod: toW3cDate(c.updatedAt),
        changefreq: "weekly",
        priority: "0.8",
      }),
    );

    const pageEntries = pages
      .filter((p) => clinicSlugById.has(String(p.clinicId)))
      .map((p) =>
        urlWithHreflang({
          loc: `${FRONTEND_URL}/clinics/${encodeURIComponent(
            clinicSlugById.get(String(p.clinicId)),
          )}/dp/${encodeURIComponent(p.slug)}`,
          lastmod: toW3cDate(p.updatedAt),
          changefreq: "weekly",
          priority: "0.7",
        }),
      );

    const articleEntries = articles
      .map((a) => ({ a, page: pageById.get(String(a.pageId)) }))
      .filter(({ page }) => page?.clinicSlug && page?.slug)
      .map(({ a, page }) =>
        urlWithHreflang({
          loc: `${FRONTEND_URL}/clinics/${encodeURIComponent(
            page.clinicSlug,
          )}/dp/${encodeURIComponent(page.slug)}/articles/${encodeURIComponent(
            a.slug,
          )}`,
          lastmod: toW3cDate(a.updatedAt),
          changefreq: "monthly",
          priority: "0.65",
        }),
      );

    return {
      clinics: clinicEntries,
      pages: pageEntries,
      articles: articleEntries,
    };
  } catch (err) {
    console.error("[sitemap] fetchClinicUrls:", err.message);
    return empty;
  }
}

// ─── BUILD ────────────────────────────────────────────────────────────
async function buildSitemapXml() {
  const [
    doctors,
    news,
    synthesis,
    doctorArticles,
    scientificArticles,
    docs,
    clinicUrls,
  ] = await Promise.all([
    fetchDoctors(),
    fetchNews(),
    fetchSynthesisArticles(),
    fetchDoctorArticles(),
    fetchScientificArticles(),
    fetchDocsSections(),
    fetchClinicUrls(),
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
  let allEntries = [
    ...staticEntries,
    ...docs,
    ...doctors,
    ...news,
    ...synthesis,
    ...doctorArticles,
    ...scientificArticles,
    ...clinicUrls.clinics,
    ...clinicUrls.pages,
    ...clinicUrls.articles,
  ];

  console.log(
    `[sitemap] Built: ${allEntries.length} entries` +
      ` | docs: ${docs.length}` +
      ` | doctors: ${doctors.length}` +
      ` | news: ${news.length}` +
      ` | synthesis: ${synthesis.length} (×6 langs)` +
      ` | doctor-articles: ${doctorArticles.length}` +
      ` | scientific: ${scientificArticles.length}` +
      ` | clinics: ${clinicUrls.clinics.length}` +
      ` | clinic-pages: ${clinicUrls.pages.length}` +
      ` | clinic-articles: ${clinicUrls.articles.length}`,
  );

  // Синтез даёт 6 записей на статью, так что общий счётчик растёт быстрее
  // числа материалов. Перебор лимита — не «чуть хуже индексация», а отказ
  // разбирать файл целиком, поэтому режем сами и пишем об этом в лог.
  if (allEntries.length > MAX_URLS) {
    console.error(
      `[sitemap] ВНИМАНИЕ: ${allEntries.length} URL при лимите ${MAX_URLS} —` +
        ` хвост (${allEntries.length - MAX_URLS}) обрезан. Пора разбивать` +
        ` sitemap на несколько файлов с индексом.`,
    );
    allEntries = allEntries.slice(0, MAX_URLS);
  }

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
# Кабинет клиники. Публичные витрины /clinics/ под это НЕ подпадают: robots
# сверяет префикс посимвольно, а там после "/clinic" идёт "s", а не "/".
Disallow: /clinic/

# Страницы по одноразовым подписанным ссылкам из писем
Disallow: /previsit/
Disallow: /pay/

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
