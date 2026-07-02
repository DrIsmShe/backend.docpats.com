// server/modules/clinic/clinic-gallery/routes/clinicGalleryItem.routes.js
//
// Роуты галереи категорий. Монтируются в clinic-core роутере (tenant).
// Префикс: /api/v1/clinic
//
//   GET    /gallery?pageId=     список фото категории
//   POST   /gallery             добавить фото
//   PATCH  /gallery/reorder     изменить порядок
//   PATCH  /gallery/:id         обновить (caption/description)
//   DELETE /gallery/:id         удалить
//
// ВАЖНО: /gallery/reorder объявлен ДО /gallery/:id (иначе "reorder" уйдёт в :id).

import express from "express";
import * as ctrl from "../controllers/clinicGalleryItem.controller.js";

const router = express.Router();

router.get("/gallery", ctrl.listGalleryItems);
router.post("/gallery", ctrl.createGalleryItem);
router.patch("/gallery/reorder", ctrl.reorderGallery);
router.patch("/gallery/:id", ctrl.updateGalleryItem);
router.delete("/gallery/:id", ctrl.deleteGalleryItem);

export default router;
