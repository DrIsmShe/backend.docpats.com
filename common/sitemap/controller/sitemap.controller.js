import {
  getArticlesSitemap,
  getDoctorsSitemap,
  getSitemapIndex,
} from "../services/sitemap.service.js";

const XML_HEADERS = (res) => {
  res.header("Content-Type", "application/xml");
  // FIX: Cache-Control для CDN/прокси — 10 минут, совпадает с CACHE_TTL
  res.header("Cache-Control", "public, max-age=600");
};

// INDEX
export const sitemapIndex = (req, res) => {
  try {
    // FIX: getSitemapIndex синхронный (статическая строка)
    const xml = getSitemapIndex();
    XML_HEADERS(res);
    res.send(xml);
  } catch (err) {
    console.error("Sitemap Index error:", err);
    res.status(500).send("Error generating sitemap index");
  }
};

// ARTICLES
export const sitemapArticles = async (req, res) => {
  try {
    const xml = await getArticlesSitemap();
    XML_HEADERS(res);
    res.send(xml);
  } catch (err) {
    console.error("Sitemap Articles error:", err);
    res.status(500).send("Error generating sitemap articles");
  }
};

// DOCTORS
export const sitemapDoctors = async (req, res) => {
  try {
    const xml = await getDoctorsSitemap();
    XML_HEADERS(res);
    res.send(xml);
  } catch (err) {
    console.error("Sitemap Doctors error:", err);
    res.status(500).send("Error generating sitemap doctors");
  }
};
