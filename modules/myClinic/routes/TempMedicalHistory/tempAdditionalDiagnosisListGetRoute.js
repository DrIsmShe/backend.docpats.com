import { Router } from "express";
import tempAdditionalDiagnosisListGetController from "../../controllers/TempMedicalHistory/tempAdditionalDiagnosisListGetController.js";

const router = Router();

router.get("/", tempAdditionalDiagnosisListGetController);

export default router;
