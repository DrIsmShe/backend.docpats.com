// server/modules/clinic/clinic-articles/routes/clinicArticle.routes.js
//
// Роуты статей клиники. Монтируются в clinic-core роутере под tenantMiddleware.
// Префикс: /api/v1/clinic
//
//   GET    /articles?pageId=&status=   список статей (категории/все)
//   POST   /articles                   создать
//   GET    /articles/:id               одна статья (полный body)
//   PATCH  /articles/:id               обновить
//   PATCH  /articles/:id/publish       публикация (клиника)
//   DELETE /articles/:id               soft-delete
//
// Модерация проектом (рубильник) — admin-роут, монтируется отдельно в Э6.

import express from "express";
import * as ctrl from "../controllers/clinicArticle.controller.js";

const router = express.Router();

router.get("/articles", ctrl.listArticles);
router.post("/articles", ctrl.createArticle);
router.get("/articles/:id", ctrl.getArticle);
router.patch("/articles/:id", ctrl.updateArticle);
router.patch("/articles/:id/publish", ctrl.publishArticle);
router.delete("/articles/:id", ctrl.deleteArticle);

export default router;
