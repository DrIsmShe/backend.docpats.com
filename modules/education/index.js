// server/modules/education/index.js
//
// Агрегатор модуля подготовки к экзаменам. Монтируется в главном index.js
// как app.use("/api/v1/education", educationRoutes) — ПОСЛЕ session-
// middleware, потому что весь модуль опирается на req.session.userId.
//
// Отличие от modules/clinic/index.js: здесь НЕТ tenantMiddleware. Модуль
// глобальный, аудитория — врачи и резиденты вне зависимости от клиники.
// Клиника появляется только как опциональный владелец приватной программы
// (ExamProgram.ownerClinicId) и как получатель отчёта об обучении.

import express from "express";
import educationCatalogRouter from "./education-catalog/index.js";
import educationCategoriesRouter from "./education-categories/index.js";
import educationItemsRouter from "./education-items/index.js";
import educationAttemptsRouter from "./education-attempts/index.js";
import educationIngestRouter from "./education-ingest/index.js";
import { requireLearner } from "./middlewares/educationAuth.js";
import {
  errorHandler,
  notFoundHandler,
} from "../../common/middlewares/errorHandler.js";

const router = express.Router();

// ─── Health (до авторизации — нужен мониторингу) ──────────────────────
router.get("/health", (req, res) => {
  res.json({
    ok: true,
    module: "education",
    timestamp: new Date().toISOString(),
  });
});

// ─── Авторизация ──────────────────────────────────────────────────────
// Единая точка: дальше по цепочке req.educationActor гарантированно есть.
// Роль (автор / рецензент) проверяется точечно в роутах подмодулей.
router.use(requireLearner);

// ─── Подмодули ────────────────────────────────────────────────────────
// Порядок важен: education-items объявляет /programs/:programId/item-analysis,
// а education-catalog — /programs/:id. Каталог идёт первым, поэтому его
// "/programs/:id" не перехватит "item-analysis": Express сопоставляет
// сегменты, а не префиксы, и "/programs/x/item-analysis" не совпадёт
// с "/programs/:id" (лишний сегмент).
router.use("/", educationCatalogRouter);
router.use("/", educationCategoriesRouter);
router.use("/", educationItemsRouter);
router.use("/", educationAttemptsRouter);
router.use("/", educationIngestRouter);

// ─── 404 + обработчик ошибок ──────────────────────────────────────────
router.use(notFoundHandler);
router.use(errorHandler);

export default router;
