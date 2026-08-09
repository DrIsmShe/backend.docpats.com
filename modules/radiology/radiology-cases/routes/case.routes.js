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
// Цикл «правка → перепроверка» текстовой части кейса: разметку на кадре и
// подтверждение деидентификации машина не трогает.
router.post("/ai/autofix", requireAuthor, ctrl.aiAutofixController);
// Поиск учебных снимков по теме кейса. Отдаёт ссылки с лицензиями —
// скачивание и проверку делает человек.
router.post("/ai/find-images", requireAuthor, ctrl.aiFindImagesController);

// Образец «типового ответа чат-бота» для сигналов добросовестности — автору.
router.post("/cases/:id/ai/baseline", requireAuthor, ctrl.aiBaselineController);
// Отметки «разобрано» на замечаниях сохранённой ИИ-рецензии — автору.
router.patch("/cases/:id/ai-review/dismissed", requireAuthor, ctrl.dismissIssuesController);

router.get("/cases", ctrl.listCasesController);
router.post("/cases", requireAuthor, ctrl.createCaseController);
router.get("/cases/:id", ctrl.getCaseController);
router.patch("/cases/:id", requireAuthor, ctrl.updateCaseController);
router.post("/cases/:id/submit", requireAuthor, ctrl.submitCaseController);
router.post("/cases/:id/review", requireReviewer, ctrl.reviewCaseController);
router.delete("/cases/:id", requireReviewer, ctrl.archiveCaseController);
// Удаление без следа (черновики, в т. ч. ночные автокейсы). Отдельный
// маршрут — чтобы случайный DELETE не стирал кейс вместо архивации.
router.delete("/cases/:id/permanent", requireReviewer, ctrl.deleteCaseController);

// Ночная автогенерация вручную: «сгенерировать сейчас» из админки. Запуск
// отвечает сразу (202), за итогом клиент возвращается на /autogen/state.
router.post("/autogen/run", requireAuthor, ctrl.runAutogenController);
// Остановка идущего прогона. Отвечает сразу: прогон прервётся на границе
// пунктов плана, доделав начатый кейс.
router.post("/autogen/stop", requireAuthor, ctrl.stopAutogenController);
router.get("/autogen/state", requireAuthor, ctrl.autogenStateController);
// Включить/выключить НОЧНУЮ генерацию. Переживает перезапуск сервера:
// выключенная вечером генерация не должна ожить ночью после рестарта.
router.post("/autogen/nightly", requireAuthor, ctrl.autogenToggleController);

export default router;
