import { Router } from "express";
import {
  generateSitemap,
  generateRobots,
  invalidateSitemapCache,
} from "../services/sitemap.service.js";

const router = Router();

router.get("/sitemap.xml", generateSitemap);
router.get("/robots.txt", generateRobots);

router.post("/api/sitemap/invalidate", (req, res) => {
  const secret = req.headers["x-sitemap-secret"] || req.body?.secret;
  if (secret !== process.env.SITEMAP_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  invalidateSitemapCache();
  res.json({ ok: true });
});

export default router;
