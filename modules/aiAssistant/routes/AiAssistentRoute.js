import { Router } from "express";
import authMiddleware from "../../../common/middlewares/authvalidateMiddleware/authMiddleware.js";
import AiAssistentController from "../controller/generateClinicalSummary.js";
import { getPatientTimeline } from "../controller/patientTimelineController.js";
import {
  getDoctorAIDashboard,
  refreshDoctorAIDashboard,
} from "../controller/doctorAIDashboardController.js";

const router = Router();

router.post("/:id", authMiddleware, AiAssistentController);
router.get("/patient/:patientId/timeline", authMiddleware, getPatientTimeline);
router.get("/doctor-dashboard", authMiddleware, getDoctorAIDashboard);
router.post(
  "/doctor-dashboard/refresh",
  authMiddleware,
  refreshDoctorAIDashboard,
);

export default router;
