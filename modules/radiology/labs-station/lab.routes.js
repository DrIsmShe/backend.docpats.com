// server/modules/radiology/labs-station/lab.routes.js
//
// Маршруты станции «Анализы». Смонтированы через агрегатор radiology (роль
// learner уже проверена там); авторские действия закрыты requireAuthor.

import express from "express";
import * as ctrl from "./lab.controller.js";
import { requireAuthor } from "../middlewares/radiologyAuth.js";

const router = express.Router();

// ИИ-генерация кейса по теме — до /labs/cases/:id, чтобы не конфликтовать
// с ним по форме пути (у обоих 3 сегмента).
router.post("/labs/ai/generate", requireAuthor, ctrl.aiGenerateLabCaseController);

router.get("/labs/cases", ctrl.listLabCasesController);
router.post("/labs/cases", requireAuthor, ctrl.createLabCaseController);
router.get("/labs/cases/:id", ctrl.getLabCaseController);
router.patch("/labs/cases/:id", requireAuthor, ctrl.updateLabCaseController);
router.post("/labs/cases/:id/status", requireAuthor, ctrl.statusLabCaseController);

router.post("/labs/cases/:id/attempts", ctrl.startLabAttemptController);
router.get("/labs/attempts/:id", ctrl.getLabAttemptController);
router.post("/labs/attempts/:id/submit", ctrl.submitLabAttemptController);

export default router;
