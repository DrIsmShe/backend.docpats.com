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

// Пределы протокола: 50 000 URL И 50 МБ на файл. Уперлись мы во ВТОРОЙ,
// а сторожили первый — подробности у buildSitemapSet ниже. Границы здесь
// с запасом: лишний файл в индексе не стоит ничего, а перебор означает,
// что Google отказывается разбирать файл целиком.
const MAX_URLS_PER_FILE = 10000;
const MAX_BYTES_PER_FILE = 8 * 1024 * 1024;

// Кэш 1 час. Держим весь набор: индекс + дочерние файлы по именам.
let cache = { index: null, files: null, builtAt: 0 };
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

// Одна запись БЕЗ hreflang — для страниц, у которых языкового адреса не
// существует: язык там выбирается на клиенте (localStorage/cookie), и все
// пять версий живут по одному URL.
//
// Раньше здесь выписывались пять <xhtml:link hreflang="xx">, и все пять
// вели на ОДИН И ТОТ ЖЕ адрес. Это не языковая разметка, а её видимость:
// hreflang связывает РАЗНЫЕ адреса разных языковых версий, а ссылка
// страницы на саму себя пять раз не сообщает поисковику ничего — он не
// может проиндексировать пять версий одного URL. Пятикратно раздутый
// sitemap при этом был вполне настоящим.
//
// Где языковые адреса есть на самом деле — синтез-статьи (/articles/:id/:lang)
// и новости (?locale=xx) — разметка выписывается отдельными функциями ниже
// и указывает на разные URL, как и положено.
export function urlEntry({ loc, lastmod, changefreq, priority }) {
  return `  <url>
    <loc>${escapeXml(loc)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
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

// 5 записей на новость: голый адрес + ?locale= для четырёх остальных
// языков. Язык у новостей передаётся query-параметром, и страница его
// теперь читает (client/src/pages/NewsAI/NewsArticle.jsx) — до этого
// параметр только записывался при переключении, а при заходе по ссылке
// игнорировался.
//
// Английского ?locale=en НЕТ намеренно: английская версия живёт на голом
// адресе, и второй адрес с тем же содержимым был бы дублем, который
// поисковику пришлось бы склеивать самому.
const NEWS_DEFAULT_LANG = "en";

function newsLocaleUrl(baseUrl, lang) {
  return lang === NEWS_DEFAULT_LANG ? baseUrl : `${baseUrl}?locale=${lang}`;
}

export function urlEntriesForLocalizedNews({ baseUrl, lastmod }) {
  // Блок hreflang одинаков для всех версий — так и требует протокол:
  // каждая языковая версия перечисляет ВСЕ, включая саму себя.
  const hreflang = [
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(baseUrl)}"/>`,
    ...LANGS.map(
      (l) =>
        `    <xhtml:link rel="alternate" hreflang="${l}" href="${escapeXml(newsLocaleUrl(baseUrl, l))}"/>`,
    ),
  ].join("\n");

  return LANGS.map((lang) => {
    const loc = newsLocaleUrl(baseUrl, lang);
    return `  <url>
    <loc>${escapeXml(loc)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${lang === NEWS_DEFAULT_LANG ? "0.7" : "0.65"}</priority>
${hreflang}
  </url>`;
  }).join("\n");
}

// ─── FETCHERS ────────────────────────────────────────────────────────

// /public/doctor-profile/doctor-details/:id
// Язык выбирается на клиенте — языкового адреса нет, hreflang не пишем.
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
      urlEntry({
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

// /news/:slug  +  /news/:slug?locale=ru|az|tr|ar
// Язык ЕСТЬ в адресе (query-параметром) — генерируем 5 записей на новость.
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
      urlEntriesForLocalizedNews({
        baseUrl: `${FRONTEND_URL}/news/${encodeURIComponent(n.slug)}`,
        lastmod: toW3cDate(n.updatedAt || n.publishedAt),
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
      urlEntry({
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
      urlEntry({
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
        urlEntry({
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
//   /:slug                                     — сама витрина
//   /:slug/dp/:pageSlug                        — раздел витрины
//   /:slug/dp/:pageSlug/articles/:articleSlug  — статья раздела
//   /:slug/doctors/:doctorProfileId            — врач клиники
//   /:slug/publications/:articleId             — публикация врача
//
// Врач и публикация раньше находились только по ссылкам с витрины. Именно они
// отвечают на запрос «фамилия врача + город», поэтому заявляем их явно.
// Врач, работающий в двух опубликованных клиниках, попадёт в карту дважды —
// это разные страницы разных клиник, у каждой свой canonical на себя.
//
// Адреса КОРНЕВЫЕ, без префикса /clinics. Именно корневой адрес кабинет
// выдаёт директору и объявляет каноническим edge-функция витрины
// (client/netlify/edge-functions/seo.js). Старый /clinics/:slug продолжает
// работать и отдаёт разметку, но canonical с него ведёт на корневой — звать
// бота картой сайта на неканонический адрес значило бы тратить обход на
// страницу, которую он всё равно отбросит в пользу другой.
//
// Собираем одной функцией: слаг родителя нужен, чтобы построить URL потомка,
// поэтому идём сверху вниз и переиспользуем уже загруженные карты. Клиника
// скрыта → её разделы и статьи в sitemap не идут, даже если сами опубликованы.
// Роли, чьи участники попадают в публичный список врачей клиники. Значение
// продублировано из clinic-public.service.js намеренно: карта сайта не должна
// тянуть за собой весь публичный сервис ради одной константы, а разойтись они
// могут только вместе с самим понятием «врач клиники».
const PUBLIC_DOCTOR_ROLES = ["doctor", "owner", "admin"];

async function fetchClinicUrls() {
  const empty = {
    clinics: [],
    pages: [],
    articles: [],
    doctors: [],
    publications: [],
  };
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
      urlEntry({
        loc: `${FRONTEND_URL}/${encodeURIComponent(c.slug)}`,
        lastmod: toW3cDate(c.updatedAt),
        changefreq: "weekly",
        priority: "0.8",
      }),
    );

    const pageEntries = pages
      .filter((p) => clinicSlugById.has(String(p.clinicId)))
      .map((p) =>
        urlEntry({
          loc: `${FRONTEND_URL}/${encodeURIComponent(
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
        urlEntry({
          loc: `${FRONTEND_URL}/${encodeURIComponent(
            page.clinicSlug,
          )}/dp/${encodeURIComponent(page.slug)}/articles/${encodeURIComponent(
            a.slug,
          )}`,
          lastmod: toW3cDate(a.updatedAt),
          changefreq: "monthly",
          priority: "0.65",
        }),
      );

    // ─── Врачи клиник и их публикации ───────────────────────────────
    // Гейт тот же, что у публичного списка витрины: активное членство
    // подходящей роли, actorType "user" и наличие DoctorProfile. Кого нет в
    // публичном списке клиники, у того нет и страницы от её имени — значит и
    // в карте сайта ему делать нечего.
    const memberships = await db
      .collection(collectionOf("ClinicMembership", "clinic_memberships"))
      .find(
        {
          clinicId: { $in: clinics.map((c) => c._id) },
          role: { $in: PUBLIC_DOCTOR_ROLES },
          actorType: "user",
          isActive: true,
          leftAt: null,
        },
        { projection: { clinicId: 1, userId: 1 } },
      )
      .toArray();

    // userId → слаги клиник, где он состоит (врач может работать в нескольких)
    const clinicSlugsByUser = new Map();
    for (const m of memberships) {
      const slug = clinicSlugById.get(String(m.clinicId));
      if (!slug || !m.userId) continue;
      const key = String(m.userId);
      if (!clinicSlugsByUser.has(key)) clinicSlugsByUser.set(key, new Set());
      clinicSlugsByUser.get(key).add(slug);
    }

    const doctorUserIds = [...clinicSlugsByUser.keys()].map(
      (id) => new mongoose.Types.ObjectId(id),
    );

    const profiles = doctorUserIds.length
      ? await db
          .collection(collectionOf("DoctorProfile", "doctorprofiles"))
          .find(
            { userId: { $in: doctorUserIds } },
            { projection: { _id: 1, userId: 1, updatedAt: 1 } },
          )
          .toArray()
      : [];

    const doctorEntries = [];
    for (const p of profiles) {
      const slugs = clinicSlugsByUser.get(String(p.userId));
      if (!slugs) continue;
      for (const slug of slugs) {
        doctorEntries.push(
          urlEntry({
            loc: `${FRONTEND_URL}/${encodeURIComponent(slug)}/doctors/${p._id}`,
            lastmod: toW3cDate(p.updatedAt),
            changefreq: "monthly",
            priority: "0.7",
          }),
        );
      }
    }

    // Публикации: опубликованные статьи этих врачей, оба типа. Тип в адресе
    // не участвует — страница витрины ищет статью сразу в обеих коллекциях.
    const [opinions, scientific] = doctorUserIds.length
      ? await Promise.all([
          db
            .collection(collectionOf("Article", "articles"))
            .find(
              { authorId: { $in: doctorUserIds }, isPublished: true },
              { projection: { _id: 1, authorId: 1, updatedAt: 1 } },
            )
            .toArray(),
          db
            .collection(collectionOf("ArticleScine", "articlescines"))
            .find(
              { authorId: { $in: doctorUserIds }, isPublished: true },
              { projection: { _id: 1, authorId: 1, updatedAt: 1 } },
            )
            .toArray(),
        ])
      : [[], []];

    const publicationEntries = [];
    for (const a of [...opinions, ...scientific]) {
      const slugs = clinicSlugsByUser.get(String(a.authorId));
      if (!slugs) continue;
      for (const slug of slugs) {
        publicationEntries.push(
          urlEntry({
            loc: `${FRONTEND_URL}/${encodeURIComponent(slug)}/publications/${a._id}`,
            lastmod: toW3cDate(a.updatedAt),
            changefreq: "monthly",
            priority: "0.65",
          }),
        );
      }
    }

    return {
      clinics: clinicEntries,
      pages: pageEntries,
      articles: articleEntries,
      doctors: doctorEntries,
      publications: publicationEntries,
    };
  } catch (err) {
    console.error("[sitemap] fetchClinicUrls:", err.message);
    return empty;
  }
}

// ─── BUILD ────────────────────────────────────────────────────────────
//
// Sitemap разбит на несколько файлов с индексом, и это не «на вырост».
// Одним файлом он весил 48 МБ при жёстком пределе Google в 50 МБ: записи
// с hreflang тяжёлые (в среднем 1,6 КБ на URL), а новостной движок даёт
// около полусотни материалов в сутки, то есть по пять записей на каждый.
// Запаса оставалось на несколько дней, после чего Google отказался бы
// разбирать файл ЦЕЛИКОМ — потерялся бы не прирост, а вся индексация
// через sitemap.
//
// Прежний предохранитель сторожил не ту величину: считал количество URL
// (лимит 50 000 при фактических 30 627) и про вес не знал ничего. По
// числу записей до предела было далеко, по весу — четыре дня.

const URLSET_HEAD = `<?xml version="1.0" encoding="UTF-8"?>
<urlset
  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="
    http://www.sitemaps.org/schemas/sitemap/0.9
    http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
`;
const URLSET_TAIL = `
</urlset>`;

function countUrls(entry) {
  return (entry.match(/<url>/g) || []).length;
}

function urlsetXml(entries) {
  return URLSET_HEAD + entries.join("\n") + URLSET_TAIL;
}

// Разложить записи секции по файлам. Элемент НЕ делим: у новости внутри
// пять языковых версий, у синтез-статьи шесть, и половина набора без
// остальных — это битая hreflang-разметка, хуже, чем её отсутствие.
export function chunkEntries(entries) {
  const overhead =
    Buffer.byteLength(URLSET_HEAD, "utf8") + Buffer.byteLength(URLSET_TAIL, "utf8");
  const chunks = [];
  let cur = [];
  let curUrls = 0;
  let curBytes = overhead;

  for (const entry of entries) {
    const urls = countUrls(entry);
    const bytes = Buffer.byteLength(entry, "utf8") + 1; // +1 на перевод строки

    if (cur.length && (curUrls + urls > MAX_URLS_PER_FILE || curBytes + bytes > MAX_BYTES_PER_FILE)) {
      chunks.push(cur);
      cur = [];
      curUrls = 0;
      curBytes = overhead;
    }

    cur.push(entry);
    curUrls += urls;
    curBytes += bytes;
  }

  if (cur.length) chunks.push(cur);
  return chunks;
}

// Секции — по источникам. Разделение не косметическое: новости растут
// быстрее всего, и держать их отдельно значит, что при их разбухании
// перестраиваются только их файлы, а адреса врачей и клиник остаются
// прежними — Google не перечитывает то, что не менялось.
async function collectSections() {
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
    urlEntry({
      loc: `${FRONTEND_URL}${p.path}`,
      lastmod: toW3cDate(new Date()),
      changefreq: p.changefreq,
      priority: p.priority,
    }),
  );

  return [
    { name: "static", entries: staticEntries },
    { name: "docs", entries: docs },
    { name: "doctors", entries: doctors },
    { name: "news", entries: news },
    { name: "articles", entries: synthesis },
    { name: "doctor-articles", entries: doctorArticles },
    { name: "scientific", entries: scientificArticles },
    {
      name: "clinics",
      entries: [
        ...clinicUrls.clinics,
        ...clinicUrls.pages,
        ...clinicUrls.articles,
        ...clinicUrls.doctors,
        ...clinicUrls.publications,
      ],
    },
  ];
}

/**
 * Собрать индекс и все дочерние файлы.
 * @returns {Promise<{index: string, files: Map<string, string>}>}
 */
export async function buildSitemapSet() {
  const sections = await collectSections();
  const files = new Map();
  const lastmod = toW3cDate(new Date());
  let totalUrls = 0;

  for (const section of sections) {
    // Пустую секцию в индекс не пишем: ссылка на файл с нулём URL — это
    // ошибка в Search Console, а не «пока пусто».
    if (!section.entries.length) continue;

    const chunks = chunkEntries(section.entries);
    chunks.forEach((chunk, i) => {
      const name =
        chunks.length === 1 ? section.name : `${section.name}-${i + 1}`;
      files.set(name, urlsetXml(chunk));
      totalUrls += chunk.reduce((sum, e) => sum + countUrls(e), 0);
    });
  }

  const index = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...files.keys()]
  .map(
    (n) => `  <sitemap>
    <loc>${escapeXml(`${FRONTEND_URL}/sitemap-${n}.xml`)}</loc>
    <lastmod>${lastmod}</lastmod>
  </sitemap>`,
  )
  .join("\n")}
</sitemapindex>`;

  const sizes = [...files.values()].map((x) => Buffer.byteLength(x, "utf8"));
  const biggest = sizes.length ? Math.max(...sizes) : 0;
  console.log(
    `[sitemap] индекс: ${files.size} файлов, ${totalUrls} URL,` +
      ` самый большой ${(biggest / 1048576).toFixed(2)} МБ` +
      ` (предел файла ${(MAX_BYTES_PER_FILE / 1048576).toFixed(0)} МБ / ${MAX_URLS_PER_FILE} URL)`,
  );

  return { index, files };
}

/** Набор из кэша; собирает заново, если кэш протух. */
async function getSitemapSet() {
  const now = Date.now();
  if (cache.index && now - cache.builtAt < CACHE_TTL_MS) {
    return { set: cache, hit: true };
  }
  const built = await buildSitemapSet();
  cache = { index: built.index, files: built.files, builtAt: now };
  return { set: cache, hit: false };
}

/**
 * Все публичные URL парами {loc, lastmod} — для IndexNow-job.
 *
 * Разбор живёт здесь, а не в job: формат XML знает этот модуль, и
 * второй разборщик в другом файле разошёлся бы с ним при первой же
 * правке разметки.
 */
export async function collectAllUrlPairs() {
  const { set } = await getSitemapSet();
  const pairs = [];

  for (const xml of set.files.values()) {
    // Поблочно: в одном <url> ровно один <loc>, а вот <xhtml:link href=...>
    // внутри тоже содержит адреса — их брать нельзя, иначе один URL уедет
    // в отправку по шесть раз.
    const blocks = xml.match(/<url>[\s\S]*?<\/url>/g) || [];
    for (const block of blocks) {
      const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1];
      if (!loc) continue;
      const lastmod = block.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1] || "";
      pairs.push({ loc: unescapeXml(loc), lastmod });
    }
  }

  return pairs;
}

function unescapeXml(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&"); // последним: иначе &amp;lt; развернётся дважды
}

// ─── CONTROLLERS ─────────────────────────────────────────────────────

/** GET /sitemap.xml — теперь ИНДЕКС, а не список URL. */
export async function generateSitemap(req, res) {
  try {
    const { set, hit } = await getSitemapSet();
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("X-Sitemap-Cache", hit ? "HIT" : "MISS");
    return res.send(set.index);
  } catch (err) {
    console.error("[sitemap] error:", err);
    return res.status(500).json({ error: "Sitemap generation failed" });
  }
}

/** GET /sitemap-<секция>.xml — дочерний файл индекса. */
export async function generateSitemapFile(req, res) {
  try {
    const name = req.params.name || req.params[0];
    const { set, hit } = await getSitemapSet();
    const xml = set.files.get(name);

    // 404, а не пустой urlset: пустой файл Search Console показывает как
    // успешно обработанный с нулём страниц, и опечатку в имени невозможно
    // заметить.
    if (!xml) return res.status(404).json({ error: "Unknown sitemap section" });

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("X-Sitemap-Cache", hit ? "HIT" : "MISS");
    return res.send(xml);
  } catch (err) {
    console.error("[sitemap] file error:", err);
    return res.status(500).json({ error: "Sitemap generation failed" });
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
# Отдельный файл для Google News: там своё окно в 48 часов и свой формат.
Sitemap: ${FRONTEND_URL}/news-sitemap.xml
`;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400");
  return res.send(txt);
}

export function invalidateSitemapCache() {
  cache = { index: null, files: null, builtAt: 0 };
  console.log("[sitemap] Cache invalidated");
}
