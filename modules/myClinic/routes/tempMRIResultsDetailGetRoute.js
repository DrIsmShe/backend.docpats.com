import { Router } from "express";
import tempMRIResultsDetailGetController from "../controllers/TempResultControllers/tempMRIResultsDetailGetController.js";

const router = Router();

router.get("/:id", tempMRIResultsDetailGetController);

export default router;
