import { Router } from "express";

import tempCTScanResultsDeleteController from "../controllers/TempResultControllers/tempCTScanResultsDeleteController.js";

const router = Router();

router.delete("/:id", tempCTScanResultsDeleteController);

export default router;
