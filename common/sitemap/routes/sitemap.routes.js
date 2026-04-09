import express from "express";
import {
  sitemapIndex,
  sitemapArticles,
  sitemapDoctors,
} from "../controller/sitemap.controller.js";

const router = express.Router();

router.get("/sitemap.xml", sitemapIndex);
router.get("/sitemap-articles.xml", sitemapArticles);
router.get("/sitemap-doctors.xml", sitemapDoctors);

export default router;
