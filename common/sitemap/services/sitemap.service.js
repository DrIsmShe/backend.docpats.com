import { SitemapStream, streamToPromise } from "sitemap";

import Article from "../../models/Articles/articles.js";
import ArticleScience from "../../models/Articles/articles-scince.js";
import DoctorProfile from "../../models/DoctorProfile/profileDoctor.js";
import { pingSearchEngines } from "../../seo/seo.service.js";

// ======================= CONFIG =======================
const HOSTNAME = "https://docpats.com";
const CACHE_TTL = 1000 * 60 * 10; // 10 минут

// ======================= CACHE =======================
// FIX: у каждой записи свой таймер — общий lastGenerated ломал кеш
// (isValid(articles) возвращал true пока data=null после частичного сброса)
const cache = {
  articles: { data: null, ts: 0 },
  doctors: { data: null, ts: 0 },
  index: { data: null, ts: 0 }, // статическая строка — не устаревает
};

const isValid = (entry) =>
  entry.data !== null && Date.now() - entry.ts < CACHE_TTL;

// ======================= ARTICLES =======================
export const getArticlesSitemap = async () => {
  if (isValid(cache.articles)) return cache.articles.data;

  const sitemap = new SitemapStream({ hostname: HOSTNAME });

  try {
    // FIX: параллельные запросы вместо последовательных
    const [articles, scienceArticles] = await Promise.all([
      Article.find({ isPublished: true }).select("_id updatedAt").lean(),
      ArticleScience.find({ isPublished: true }).select("_id updatedAt").lean(),
    ]);

    // Статические страницы
    sitemap.write({ url: "/", priority: 1.0, changefreq: "daily" });
    sitemap.write({
      url: "/doctor-articles",
      priority: 0.9,
      changefreq: "daily",
    });
    sitemap.write({
      url: "/doctor-insight",
      priority: 0.8,
      changefreq: "weekly",
    });

    for (const a of articles) {
      sitemap.write({
        url: `/doctor-articles/${a._id}`,
        lastmod: a.updatedAt || new Date(),
        changefreq: "weekly",
        priority: 0.8,
      });
    }

    for (const a of scienceArticles) {
      sitemap.write({
        url: `/doctor-insight/${a._id}`,
        lastmod: a.updatedAt || new Date(),
        changefreq: "weekly",
        priority: 0.8,
      });
    }

    sitemap.end();
    const xml = (await streamToPromise(sitemap)).toString();

    cache.articles = { data: xml, ts: Date.now() };
    return xml;
  } catch (err) {
    // FIX: закрываем стрим чтобы промис не завис
    sitemap.destroy?.();
    throw err;
  }
};

// ======================= DOCTORS =======================
export const getDoctorsSitemap = async () => {
  if (isValid(cache.doctors)) return cache.doctors.data;

  const sitemap = new SitemapStream({ hostname: HOSTNAME });

  try {
    const doctors = await DoctorProfile.find({ isVerified: true })
      .select("_id updatedAt")
      .lean();

    for (const d of doctors) {
      sitemap.write({
        url: `/doctor-profile/${d._id}`,
        lastmod: d.updatedAt || new Date(),
        changefreq: "weekly",
        priority: 0.7,
      });
    }

    sitemap.end();
    const xml = (await streamToPromise(sitemap)).toString();

    cache.doctors = { data: xml, ts: Date.now() };
    return xml;
  } catch (err) {
    sitemap.destroy?.();
    throw err;
  }
};

// ======================= INDEX =======================
// FIX: статическая строка — кешируем навсегда (не зависит от БД)
export const getSitemapIndex = () => {
  if (cache.index.data) return cache.index.data;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">

  <sitemap>
    <loc>${HOSTNAME}/sitemap-articles.xml</loc>
  </sitemap>

  <sitemap>
    <loc>${HOSTNAME}/sitemap-doctors.xml</loc>
  </sitemap>

</sitemapindex>`;

  cache.index = { data: xml, ts: Date.now() };
  return xml;
};

// ======================= CACHE CLEAR =======================
export const clearSitemapCache = async () => {
  cache.articles = { data: null, ts: 0 };
  cache.doctors = { data: null, ts: 0 };
  // index статический — не сбрасываем

  await pingSearchEngines();
};
