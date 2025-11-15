import { Router } from "express";
import tempCTScanResultsController from "../controllers/TempResultControllers/tempCTScanResultsController.js";
import authMidleWeare from "../../../common/middlewares/authMiddleware.js";
const router = Router();

router.post("/", authMidleWeare, tempCTScanResultsController);
export default router;
