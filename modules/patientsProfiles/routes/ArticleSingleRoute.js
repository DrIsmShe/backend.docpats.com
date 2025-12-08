import express from "express";
import { getSingleArticle } from "../controllers/getSingleArticleController.js"; // Импортируем контроллер

const router = express.Router();

// Маршрут для получения одной статьи
router.get("/:id", getSingleArticle);

export default router;
