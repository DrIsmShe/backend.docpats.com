import { Router } from "express";
import tempUltrasoundResultsDetailGetController from "../controllers/TempResultControllers/tempUltrasoundResultsDetailGetController.js";

const router = Router();

router.get("/:id", tempUltrasoundResultsDetailGetController);

export default router;
