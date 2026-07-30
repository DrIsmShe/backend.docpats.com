// server/modules/radiology/index.js
//
// Агрегатор модуля лучевой диагностики. Монтируется в главном index.js как
// app.use("/api/v1/radiology", radiologyRoutes) — ПОСЛЕ session-middleware,
// потому что весь модуль опирается на req.session.userId.
//
// Устроен как education/index.js и по тем же причинам: глобальный модуль
// (аудитория — врачи/резиденты вне клиники), без tenantMiddleware. Своя
// лестница ролей (middlewares/radiologyAuth.js), потому что common/auth/can.js
// завязан на ClinicMembership.
//
// Принцип «одна система на одно исследование» живёт в reading-systems/ —
// реестре плагинов-модальностей (по образцу extractors/ в education).

import express from "express";
import radiologyCasesRouter from "./radiology-cases/index.js";
import radiologyAttemptsRouter from "./radiology-attempts/index.js";
import gameRouter from "./game/game.routes.js";
import labRouter from "./labs-station/lab.routes.js";
import vpRouter from "./virtual-patient/vp.routes.js";
import analyticsRouter from "./analytics/analytics.routes.js";
import duelRouter from "./duels/duel.routes.js";
import reviewRouter from "./review/review.routes.js";
import translationRouter from "./translation/translation.routes.js";
import { requireLearner } from "./middlewares/radiologyAuth.js";
import {
  errorHandler,
  notFoundHandler,
} from "../../common/middlewares/errorHandler.js";

const router = express.Router();

// Health — до авторизации, нужен мониторингу.
router.get("/health", (req, res) => {
  res.json({ ok: true, module: "radiology", timestamp: new Date().toISOString() });
});

// Единая точка авторизации: дальше req.radiologyActor гарантированно есть.
// Роль (автор/рецензент) проверяется точечно в роутах подмодулей.
router.use(requireLearner);

// Подмодули. Порядок безопасен: /cases/:id/attempts (3 сегмента) не
// конфликтует с /cases/:id (2 сегмента).
router.use("/", radiologyCasesRouter);
router.use("/", radiologyAttemptsRouter);
router.use("/", gameRouter);
router.use("/", labRouter);
router.use("/", vpRouter);
router.use("/", analyticsRouter);
router.use("/", duelRouter);
router.use("/", reviewRouter);
router.use("/", translationRouter);

router.use(notFoundHandler);
router.use(errorHandler);

export default router;
