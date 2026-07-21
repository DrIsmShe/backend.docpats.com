// server/modules/education/education-attempts/routes/attempt.routes.js
//
// Контур учащегося: дополнительной роли не требует, requireLearner уже
// применён в education/index.js.

import express from "express";
import * as ctrl from "../controllers/attempt.controller.js";

const router = express.Router();

router.get("/attempts", ctrl.listAttemptsController);
router.post("/attempts", ctrl.startAttemptController);
router.get("/attempts/:id", ctrl.getAttemptController);
router.post("/attempts/:id/answer", ctrl.answerController);
router.post("/attempts/:id/submit", ctrl.submitAttemptController);

router.get("/programs/:programId/readiness", ctrl.readinessController);

export default router;
