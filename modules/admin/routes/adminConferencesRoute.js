// modules/admin/routes/adminConferencesRoute.js
//
// Модерация конференций. Монтируется в admin/index.js на "/conferences".

import { Router } from "express";
import requireAdmin from "./isAdminRoute.js";
import {
  listConferencesForModeration,
  createConference,
  moderateConference,
  runIngestion,
  enrichConferences,
  translateConferences,
} from "../controllers/adminConferences.controller.js";

const router = Router();
router.use(requireAdmin);

router.get("/", listConferencesForModeration);
router.post("/", createConference);
// Отдельным путём, а не параметром у POST "/": обход платный, и его стоит
// видеть в логах и правах как самостоятельное действие.
router.post("/run-ingestion", runIngestion);
router.post("/enrich", enrichConferences);
router.post("/translate", translateConferences);
router.patch("/:id", moderateConference);

export default router;
