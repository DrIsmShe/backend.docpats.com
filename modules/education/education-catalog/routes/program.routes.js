// server/modules/education/education-catalog/routes/program.routes.js
//
// Смонтировано в education/index.js как router.use("/", programRoutes),
// поэтому префикс /programs живёт здесь.
//
// Читать каталог может любой авторизованный пользователь (requireLearner
// применён на уровне агрегатора). Править — только автор каталога;
// публиковать и архивировать — только рецензент.

import express from "express";
import * as ctrl from "../controllers/program.controller.js";
import {
  requireAuthor,
  requireReviewer,
} from "../../middlewares/educationAuth.js";

const router = express.Router();

router.get("/programs", ctrl.listProgramsController);
router.get("/programs/countries", ctrl.listCountriesController);
// Отдельный маршрут по коду — витрина ходит по человекочитаемому коду,
// а не по ObjectId. Объявлен ДО "/programs/:id", иначе "code" съест "by-code".
router.get("/programs/by-code/:code", ctrl.getProgramByCodeController);
// Блоки теста — до "/programs/:id" по той же причине (лишний сегмент).
router.get("/programs/:id/blocks", ctrl.getProgramBlocksController);
router.get("/programs/:id", ctrl.getProgramController);

router.post("/programs", requireAuthor, ctrl.createProgramController);
router.patch("/programs/:id", requireAuthor, ctrl.updateProgramController);
// DELETE /programs/:id — мягкий архив (обратимо). /hard — удаление насовсем.
router.delete("/programs/:id", requireReviewer, ctrl.archiveProgramController);
router.delete("/programs/:id/hard", requireReviewer, ctrl.deleteProgramController);

export default router;
