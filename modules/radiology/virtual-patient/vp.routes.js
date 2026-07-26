// server/modules/radiology/virtual-patient/vp.routes.js
//
// Маршруты режима «Виртуальный пациент». Смонтированы через агрегатор
// radiology (роль learner уже проверена); авторские действия — requireAuthor.

import express from "express";
import * as ctrl from "./vp.controller.js";
import { requireAuthor } from "../middlewares/radiologyAuth.js";

const router = express.Router();

// ИИ-генерация сценария по теме — только автору.
router.post("/vp/ai/generate", requireAuthor, ctrl.aiGenerateVpController);
router.post("/vp/ai/verify", requireAuthor, ctrl.aiVerifyVpController);

router.get("/vp/cases", ctrl.listVpController);
router.post("/vp/cases", requireAuthor, ctrl.createVpController);
router.get("/vp/cases/:id", ctrl.getVpController);
router.patch("/vp/cases/:id", requireAuthor, ctrl.updateVpController);
router.post("/vp/cases/:id/status", requireAuthor, ctrl.statusVpController);

// Образец «типового ответа чат-бота» для сигналов добросовестности — автору.
router.post("/vp/cases/:id/ai/baseline", requireAuthor, ctrl.aiBaselineVpController);

// Условия попытки до старта (зачёт/тренировка, лимит, следующий зачёт).
router.get("/vp/cases/:id/policy", ctrl.vpPolicyController);
router.post("/vp/cases/:id/attempts", ctrl.startVpController);
// Предварительный дифдиагноз — до заказа обследований.
router.post("/vp/attempts/:id/commit", ctrl.commitVpController);
router.post("/vp/attempts/:id/order", ctrl.orderVpController);
router.post("/vp/attempts/:id/submit", ctrl.submitVpController);
router.get("/vp/attempts/:id", ctrl.getVpAttemptController);

export default router;
