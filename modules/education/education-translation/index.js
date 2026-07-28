// server/modules/education/education-translation/index.js
//
// Роуты переводов вопросов. Редакторский контур: просмотр состояния по
// языкам, запуск перевода, ручная правка.
//
// Права: чтение и запуск — автор, ручная правка текста — тоже автор.
// Отдельного «рецензента переводов» намеренно нет: перевод не может изменить,
// какой ответ верен (correctKeys копируются дословно), поэтому гейт публикации
// здесь не нужен — он уже пройден оригиналом.

import express from "express";
import * as ctrl from "./translation.controller.js";
import { requireAuthor } from "../middlewares/educationAuth.js";

const router = express.Router();

router.get("/items/:id/translations", requireAuthor, ctrl.listTranslationsController);
router.post("/items/:id/translations", requireAuthor, ctrl.translateItemController);
router.patch("/translations/:id", requireAuthor, ctrl.updateTranslationController);
router.post("/translations/:id/unreview", requireAuthor, ctrl.unreviewTranslationController);

export default router;
