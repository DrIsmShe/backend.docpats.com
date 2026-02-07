import { Router } from "express";
import patientsMedicalHistoryGetController from "../controllers/patientsMedicalHistoryGetController.js";
const router = Router();

router.get("/:id", patientsMedicalHistoryGetController);
export default router;
