// server/modules/education/education-categories/routes/category.routes.js
//
// Смонтировано в education/index.js как router.use("/", categoryRoutes),
// поэтому префикс /categories живёт здесь.
//
// Читать рубрикатор может любой авторизованный (requireLearner применён в
// агрегаторе). Создавать и править — автор каталога; удалять — рецензент,
// как и у программ: удаление рубрики сильнее правки.

import express from "express";
import * as ctrl from "../controllers/category.controller.js";
import {
  requireAuthor,
  requireReviewer,
} from "../../middlewares/educationAuth.js";

const router = express.Router();

router.get("/categories", ctrl.listCategoriesController);
router.post("/categories", requireAuthor, ctrl.createCategoryController);
router.patch("/categories/:id", requireAuthor, ctrl.updateCategoryController);
router.delete("/categories/:id", requireReviewer, ctrl.deleteCategoryController);

export default router;
