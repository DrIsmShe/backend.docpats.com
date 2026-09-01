// server/modules/admin/routes/newsEngineJobsRoute.js
import express from "express";
import { requireAdmin } from "./isAdminRoute.js";
import {
  getEngineJobs,
  setEngineJobs,
} from "../controllers/newsEngineJobs.controller.js";

const router = express.Router();

// Только администратор: остановка генерации — действие с последствиями.
router.get("/", requireAdmin, getEngineJobs);
router.put("/", requireAdmin, setEngineJobs);

export default router;
