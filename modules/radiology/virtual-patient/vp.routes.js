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

router.get("/vp/cases", ctrl.listVpController);
router.post("/vp/cases", requireAuthor, ctrl.createVpController);
router.get("/vp/cases/:id", ctrl.getVpController);
router.patch("/vp/cases/:id", requireAuthor, ctrl.updateVpController);
router.post("/vp/cases/:id/status", requireAuthor, ctrl.statusVpController);

router.post("/vp/cases/:id/attempts", ctrl.startVpController);
router.post("/vp/attempts/:id/order", ctrl.orderVpController);
router.post("/vp/attempts/:id/submit", ctrl.submitVpController);
router.get("/vp/attempts/:id", ctrl.getVpAttemptController);

export default router;
