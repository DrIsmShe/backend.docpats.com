import { Router } from "express";
import tempMRIResultsListGetController from "../controllers/TempResultControllers/tempMRIResultsListGetController.js";

const router = Router();

router.get("/", tempMRIResultsListGetController);

export default router;
