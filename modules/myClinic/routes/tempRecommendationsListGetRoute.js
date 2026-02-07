import { Router } from "express";
import tempRecommendationsListGetController from "../controllers/TempResultControllers/tempRecommendationsListGetController.js";

const router = Router();

router.get("/", tempRecommendationsListGetController);

export default router;
