import { Router } from "express";
import tempCTScanResultsListGetController from "../controllers/TempResultControllers/tempCTScanResultsListGetController.js";

const router = Router();

router.get("/", tempCTScanResultsListGetController);

export default router;
