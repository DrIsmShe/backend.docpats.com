// server/modules/radiology/game/game.routes.js
//
// Маршруты «Диагностической арены». Роль learner уже проверена агрегатором
// модуля (router.use(requireLearner) в radiology/index.js).

import express from "express";
import * as ctrl from "./game.controller.js";

const router = express.Router();

router.get("/game/profile", ctrl.profileController);
router.get("/game/leaderboard", ctrl.leaderboardController);
router.get("/game/daily", ctrl.dailyController);
router.get("/game/weekly", ctrl.weeklyController);

export default router;
