import { Router } from "express";
import TempCTScanResultsDetailGetController from "../controllers/TempResultControllers/tempCTScanResultsDetailGetController.js";

const router = Router();

router.get("/:id", TempCTScanResultsDetailGetController);

export default router;
