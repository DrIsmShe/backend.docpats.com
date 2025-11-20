import { Router } from "express";
import tempRecommendationsDetailGetController from "../controllers/TempResultControllers/tempRecommendationsDetailGetController.js";

const router = Router();

router.get("/:id", tempRecommendationsDetailGetController);

export default router;
