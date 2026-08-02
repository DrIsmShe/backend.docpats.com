// server/modules/dictation/index.js
//
// Голосовая надиктовка истории болезни. Монтируется в главном index.js как
// app.use("/api/v1/dictation", dictationRoutes) — ПОСЛЕ session-middleware,
// потому что весь модуль опирается на req.session.userId.
//
// Устройство: движок отдельно, приёмник отдельно.
//
//   providers/   распознавание речи и сборка структуры — сменные шаги
//   sinks/       куда приземляется черновик; сейчас только myClinic
//   worker/      фоновая обработка очереди
//
// Про модуль-получатель знает ровно один файл — sinks/myClinic.sink.js.
// Когда дойдёт очередь до clinic, добавится второй приёмник, а движок
// останется прежним. Тот же приём, что в radiology/reading-systems.

import express from "express";
import authMiddleware from "../../common/middlewares/authMiddleware.js";
import resolvePatient from "../../common/middlewares/resolvePatient.js";
import { upload } from "../../common/middlewares/uploadMiddleware.js";
import * as ctrl from "./dictation.controller.js";
import {
  errorHandler,
  notFoundHandler,
} from "../../common/middlewares/errorHandler.js";

const router = express.Router();

// Готовность модуля — до тяжёлых маршрутов, нужен интерфейсу при открытии.
router.get("/status", authMiddleware, ctrl.statusController);

// Приём аудио. resolvePatient кладёт в req пациента и его тип по :patientId —
// тот же порядок, что у остальных маршрутов myClinic, работающих с пациентом.
router.post(
  "/patients/:id/upload",
  authMiddleware,
  resolvePatient,
  upload.single("audio"),
  ctrl.uploadController,
);

router.get("/jobs", authMiddleware, ctrl.listController);
router.get("/jobs/:id", authMiddleware, ctrl.getController);
router.patch("/jobs/:id/draft", authMiddleware, ctrl.updateDraftController);
// Прикрепление создаёт ЧЕРНОВИК истории болезни. Подписывает врач отдельно,
// обычным путём модуля — эта граница держит запись человеческой.
router.post("/jobs/:id/attach", authMiddleware, ctrl.attachController);
router.delete("/jobs/:id", authMiddleware, ctrl.discardController);

router.use(notFoundHandler);
router.use(errorHandler);

export default router;
