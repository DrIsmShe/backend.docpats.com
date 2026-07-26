// server/modules/radiology/review/review.routes.js
//
// «Работа над ошибками» — очередь повторения текущего учащегося. Очередь
// общая для трёх станций; ?station=radiology|labs|vp сужает выборку, без
// параметра приходит всё сразу (у каждого элемента есть поле station).

import express from "express";
import { asyncHandler } from "../../../common/middlewares/errorHandler.js";
import { listDue, listAll, REVIEW_STATIONS } from "./review.service.js";

const router = express.Router();

function stationParam(req) {
  const s = String(req.query.station ?? "").trim();
  return REVIEW_STATIONS.includes(s) ? s : null;
}

router.get(
  "/review/due",
  asyncHandler(async (req, res) => {
    res.json({ items: await listDue(req.radiologyActor.userId, stationParam(req)) });
  }),
);

router.get(
  "/review",
  asyncHandler(async (req, res) => {
    res.json({ items: await listAll(req.radiologyActor.userId, stationParam(req)) });
  }),
);

export default router;
