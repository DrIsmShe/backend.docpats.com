// server/modules/admin/routes/aiSettingsRoute.js
//
// Управление моделями ИИ. Только администратор проекта: выбор модели —
// это выбор того, чем платформа думает и сколько это стоит.

import { Router } from "express";
import requireAdmin from "./isAdminRoute.js";
import {
  getAiSettings,
  patchAiSettings,
} from "../controllers/aiSettings.controller.js";

const router = Router();
router.use(requireAdmin);

router.get("/", getAiSettings);
router.patch("/", patchAiSettings);

export default router;
