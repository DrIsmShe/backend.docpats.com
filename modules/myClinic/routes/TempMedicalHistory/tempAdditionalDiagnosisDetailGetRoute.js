import { Router } from "express";
import tempAdditionalDiagnosisDetailGetController from "../../controllers/TempMedicalHistory/tempAdditionalDiagnosisDetailGetController.js";

const router = Router();

router.get("/:id", tempAdditionalDiagnosisDetailGetController);

export default router;
