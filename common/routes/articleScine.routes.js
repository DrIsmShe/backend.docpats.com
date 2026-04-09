import express from "express";
import {
  getArticleScineById,
  getArticleScineList,
} from "../controller/articles-scince.js";
import { resolveLanguage } from "../middlewares/resolveLanguage.js";

const router = express.Router();

router.get(
  "/my-article-scientific-single/:id",
  resolveLanguage,
  getArticleScineById,
);
router.get("/articles-scine", resolveLanguage, getArticleScineList);

export default router;
