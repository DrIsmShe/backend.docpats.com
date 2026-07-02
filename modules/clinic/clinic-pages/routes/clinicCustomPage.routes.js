// server/modules/clinic/clinic-pages/routes/clinicCustomPage.routes.js
//
// Роуты кастомных страниц. Монтируются в clinic-core роутере под
// tenantMiddleware (clinicId из сессии/контекста). Префикс: /api/v1/clinic
//
//   GET    /pages?status=     список страниц клиники
//   POST   /pages             создать
//   GET    /pages/:id         одна страница (с layout.blocks)
//   PATCH  /pages/:id         обновить
//   PATCH  /pages/:id/publish тумблер публикации
//   DELETE /pages/:id         soft-delete

import express from "express";
import * as ctrl from "../controllers/clinicCustomPage.controller.js";

const router = express.Router();

router.get("/pages", ctrl.listPages);
router.post("/pages", ctrl.createPage);
router.get("/pages/:id", ctrl.getPage);
router.patch("/pages/:id", ctrl.updatePage);
router.patch("/pages/:id/publish", ctrl.publishPage);
router.delete("/pages/:id", ctrl.deletePage);

export default router;
