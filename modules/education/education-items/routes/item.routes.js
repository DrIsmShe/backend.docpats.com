// server/modules/education/education-items/routes/item.routes.js
//
// ВАЖНО: ни один из этих маршрутов не предназначен для учащегося —
// это редакторский контур. Учащийся получает вопросы только через
// education-attempts, где они проходят через toLearnerView() и приходят
// без правильных ответов.

import express from "express";
import * as ctrl from "../controllers/item.controller.js";
import {
  requireAuthor,
  requireReviewer,
} from "../../middlewares/educationAuth.js";

const router = express.Router();

router.get("/items", requireAuthor, ctrl.listItemsController);
router.post("/items", requireAuthor, ctrl.createItemController);
router.get("/items/:id", requireAuthor, ctrl.getItemController);
router.patch("/items/:id", requireAuthor, ctrl.updateItemController);
router.post("/items/:id/submit", requireAuthor, ctrl.submitForReviewController);

// Публикация и отклонение — только рецензент. Именно здесь снимается
// блокировка с ИИ-черновиков.
router.post("/items/:id/review", requireReviewer, ctrl.reviewItemController);
router.delete("/items/:id", requireReviewer, ctrl.archiveItemController);

router.get(
  "/programs/:programId/item-analysis",
  requireAuthor,
  ctrl.itemAnalysisController,
);

export default router;
