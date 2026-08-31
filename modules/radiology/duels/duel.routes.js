// server/modules/radiology/duels/duel.routes.js
//
// Дуэли 1×1. Роль learner проверена агрегатором — играть/вызывать может
// любой авторизованный.

import express from "express";
import { asyncHandler } from "../../../common/middlewares/errorHandler.js";
import { ValidationError } from "../../../common/utils/errors.js";
import { createDuel, submitResult, listDuels } from "./duel.service.js";
import { tReq } from "../../../common/i18n/index.js";

const router = express.Router();

router.get(
  "/duels",
  asyncHandler(async (req, res) => {
    const items = await listDuels(req.radiologyActor.userId, req.query.filter);
    res.json({ items });
  }),
);

router.post(
  "/duels",
  asyncHandler(async (req, res) => {
    if (!req.body?.caseId) throw new ValidationError(tReq(req, "app.validation.caseIdRequired"));
    const duel = await createDuel(req.body.caseId, req.radiologyActor.userId);
    res.status(201).json({ duel });
  }),
);

router.post(
  "/duels/:id/result",
  asyncHandler(async (req, res) => {
    if (!req.body?.attemptId) throw new ValidationError(tReq(req, "app.validation.attemptIdRequired"));
    const duel = await submitResult(req.params.id, req.radiologyActor.userId, req.body.attemptId);
    res.json({ duel });
  }),
);

export default router;
