// server/modules/radiology/radiology-attempts/routes/attempt.routes.js

import express from "express";
import * as ctrl from "../controllers/attempt.controller.js";

const router = express.Router();

// Старт попытки по кейсу. Роль learner уже проверена агрегатором модуля
// (router.use(requireLearner) в radiology/index.js).
router.post("/cases/:id/attempts", ctrl.startAttemptController);

router.get("/attempts", ctrl.listAttemptsController);
router.get("/attempts/:id", ctrl.getAttemptController);
router.post("/attempts/:id/submit", ctrl.submitAttemptController);
// ИИ-разбор сданной попытки (диагноз, заключение, разбор). По запросу.
router.post("/attempts/:id/ai-analysis", ctrl.aiAnalysisController);

export default router;
