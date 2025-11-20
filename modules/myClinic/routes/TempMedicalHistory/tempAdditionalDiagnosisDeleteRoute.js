import { Router } from "express";

import tempAdditionalDiagnosisDeleteController from "../../controllers/TempMedicalHistory/tempAdditionalDiagnosisDeleteController.js";

const router = Router();

router.delete("/:id", tempAdditionalDiagnosisDeleteController);

export default router;
