import { Router } from "express";
import patientsMedicalHistoryGetDetailsController from "../controllers/patientsMedicalHistoryGetDetailsController.js";
const router = Router();

router.get("/:id", patientsMedicalHistoryGetDetailsController);
export default router;
