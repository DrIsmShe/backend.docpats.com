// modules/admin/routes/adminClinicsRoute.js
//
// Платформенное администрирование клиник. ВСЁ под requireAdmin.
// Монтируется в admin/index.js на "/clinics" → /admin/clinics/*.

import { Router } from "express";
import requireAdmin from "./isAdminRoute.js";
import * as ctrl from "../controllers/adminClinics.controller.js";
import {
  getClinicFeatures,
  setClinicFeature,
} from "../controllers/adminModeration.controller.js";

const router = Router();

// requireAdmin на весь суб-роутер — ни один clinic-admin эндпоинт не доступен
// без роли admin.
router.use(requireAdmin);

router.get("/", ctrl.listClinics); // список + фильтры
router.get("/stats", ctrl.clinicsStats); // сводная статистика (до /:id!)
router.get("/:id", ctrl.getClinicDetail); // детали + счётчики

router.patch("/:id/active", ctrl.setClinicActive); // блок/разблок
router.patch("/:id/tier", ctrl.setClinicTier); // смена тарифа
router.patch("/:id/verify", ctrl.setClinicVerified); // верификация

router.get("/:id/features", getClinicFeatures); // фичи клиники
router.patch("/:id/features", setClinicFeature); // вкл/выкл фичу

router.delete("/:id", ctrl.deleteClinic); // каскадное удаление (с подтверждением)

export default router;
