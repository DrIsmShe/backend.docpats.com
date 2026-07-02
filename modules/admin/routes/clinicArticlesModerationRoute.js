// server/modules/admin/routes/clinicArticlesModerationRoute.js
//
// ВИТРИНА 2.0 (Часть 3, Этап 6) — admin-роуты модерации статей клиник.
// Подключается в modules/admin/index.js. Guard isAdminRoute на каждом маршруте.

import { Router } from "express";
import {
  adminListArticles,
  adminModerateArticle,
} from "../controllers/ClinicArticlesModerationController.js";
import isAdminRoute from "./isAdminRoute.js";

const router = Router();

// список статей всех клиник (фильтры: clinicId, moderation, status, q, пагинация)
router.get("/", isAdminRoute, adminListArticles);

// рубильник: ok | disabled
router.patch("/:id/moderation", isAdminRoute, adminModerateArticle);

export default router;
