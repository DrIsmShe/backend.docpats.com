import express from "express";
import { PolyclinicPatientsChartCountryController } from "../controllers/PolyclinicPatientsChartCountryController.js";

import { PolyclinicPatientsChartController } from "../controllers//PolyclinicPatientsChartController.js";
import { DoctorsChartController } from "../controllers/DoctorsChartController.js";

const router = express.Router();

/**
 * @route GET /admin/polyclinic-static/patients-chart/:period
 * @desc  Возвращает статистику добавления пациентов по выбранному периоду
 * @access Admin / Doctor
 */
router.get("/patients-chart/:period", PolyclinicPatientsChartController);
router.get("/doctors-chart/:period", DoctorsChartController);

router.get(
  "/patients-chart-country/:period",
  PolyclinicPatientsChartCountryController
);

export default router;
