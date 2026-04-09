import express from "express";
import { getMyArticleSingle, getArticlesList } from "../controller/article.js";
import { resolveLanguage } from "../middlewares/resolveLanguage.js";

const router = express.Router();

// ⚠️ специфичные роуты ПЕРВЫМИ
router.get("/my-article-single/:id", resolveLanguage, getMyArticleSingle);
router.get("/", resolveLanguage, getArticlesList);

export default router;
