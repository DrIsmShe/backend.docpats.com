import { Router } from "express";
import tempAdditionalDiagnosisController from "../../controllers/TempMedicalHistory/tempAdditionalDiagnosisController.js";
import authMiddleware from "../../../../common/middlewares/authMiddleware.js";

const router = Router();

router.post("/", authMiddleware, tempAdditionalDiagnosisController);

export default router;
