import { Router } from "express";
import tempUltrasoundResultsListGetController from "../controllers/TempResultControllers/tempUltrasoundResultsListGetController.js";

const router = Router();

router.get("/", tempUltrasoundResultsListGetController);

export default router;
