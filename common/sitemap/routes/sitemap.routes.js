import { Router } from "express";
import {
  generateSitemap,
  generateSitemapFile,
  generateRobots,
  invalidateSitemapCache,
} from "../services/sitemap.service.js";
import {
  generateRssFeed,
  generateNewsSitemap,
  invalidateFeedCaches,
} from "../services/feeds.service.js";
import { runIndexNowSubmit } from "../../../jobs/indexnowSubmit.job.js";
import { errorText } from "../../i18n/index.js";

const router = Router();

// /sitemap.xml теперь ИНДЕКС, а не список URL: одним файлом он весил
// 48 МБ при пределе Google в 50 МБ. Дочерние файлы — /sitemap-<секция>.xml.
router.get("/sitemap.xml", generateSitemap);

// Регулярка, а не "/sitemap-:name.xml": точка в шаблоне path-to-regexp
// разбирается неочевидно, и имя секции с дефисом (doctor-articles) в такой
// записи легко режется не там. Здесь границы заданы явно.
router.get(/^\/sitemap-([a-z0-9-]+)\.xml$/, generateSitemapFile);

router.get("/robots.txt", generateRobots);

// Каналы распространения. Отдаются с корня домена, потому что и
// агрегаторы, и Google News ищут их именно там; на фронте стоит проксирование
// (netlify.toml), как и для sitemap.xml.
router.get("/rss.xml", generateRssFeed);
router.get("/news-sitemap.xml", generateNewsSitemap);

router.post("/api/sitemap/invalidate", (req, res) => {
  const secret = req.headers["x-sitemap-secret"] || req.body?.secret;
  if (secret !== process.env.SITEMAP_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  invalidateSitemapCache();
  invalidateFeedCaches();
  res.json({ ok: true });
});

// Ручной прогон IndexNow. Нужен ровно для одного: проверить связку
// «ключ на фронте ↔ INDEXNOW_KEY на сервере» сразу после деплоя, не
// дожидаясь ближайшего часа. Под тем же секретом, что и инвалидация.
//
// Секрет передавать ЗАГОЛОВКОМ. Роутер смонтирован в index.js раньше
// express.json (ему нужно отдавать sitemap.xml до всех парсеров), поэтому
// req.body здесь пуст — ветка с body осталась только ради симметрии с
// соседним обработчиком.
router.post("/api/seo/indexnow/run", async (req, res) => {
  const secret = req.headers["x-sitemap-secret"] || req.body?.secret;
  if (secret !== process.env.SITEMAP_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const result = await runIndexNowSubmit();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[indexnow] ручной прогон:", err.message);
    res.status(500).json({ error: errorText(err, req) });
  }
});

export default router;
