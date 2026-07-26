// server/modules/radiology/radiology-cases/routes/case.routes.js

import express from "express";
import * as ctrl from "../controllers/case.controller.js";
import { requireAuthor, requireReviewer } from "../../middlewares/radiologyAuth.js";
import { upload } from "../../../../common/middlewares/uploadMiddleware.js";

const router = express.Router();

// Конфигурация систем чтения — нужна и учащемуся (вьюер), и автору.
router.get("/reading-systems", ctrl.listReadingSystemsController);

// Загрузка снимка (multipart, поле "image") — только автору. Возвращает
// публичный URL и размеры; их автор кладёт в images[] кейса.
router.post("/uploads", requireAuthor, upload.single("image"), ctrl.uploadImageController);

// ИИ-черновик кейса по снимку — только автору.
router.post("/ai/draft", requireAuthor, ctrl.aiDraftController);

// ИИ-кейс целиком по теме (снимок автор добавит сам) — только автору.
router.post("/ai/generate", requireAuthor, ctrl.aiGenerateController);

// ИИ-проверка кейса вторым проходом — только автору.
router.post("/ai/verify", requireAuthor, ctrl.aiVerifyController);

// Образец «типового ответа чат-бота» для сигналов добросовестности — автору.
router.post("/cases/:id/ai/baseline", requireAuthor, ctrl.aiBaselineController);

router.get("/cases", ctrl.listCasesController);
router.post("/cases", requireAuthor, ctrl.createCaseController);
router.get("/cases/:id", ctrl.getCaseController);
router.patch("/cases/:id", requireAuthor, ctrl.updateCaseController);
router.post("/cases/:id/submit", requireAuthor, ctrl.submitCaseController);
router.post("/cases/:id/review", requireReviewer, ctrl.reviewCaseController);
router.delete("/cases/:id", requireReviewer, ctrl.archiveCaseController);

export default router;
