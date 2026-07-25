// server/modules/radiology/review/review.routes.js
//
// «Работа над ошибками» — очередь повторения текущего учащегося.

import express from "express";
import { asyncHandler } from "../../../common/middlewares/errorHandler.js";
import { listDue, listAll } from "./review.service.js";

const router = express.Router();

router.get(
  "/review/due",
  asyncHandler(async (req, res) => {
    res.json({ items: await listDue(req.radiologyActor.userId) });
  }),
);

router.get(
  "/review",
  asyncHandler(async (req, res) => {
    res.json({ items: await listAll(req.radiologyActor.userId) });
  }),
);

export default router;
