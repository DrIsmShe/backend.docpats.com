import { Router } from "express";

import tempRecommendationsDeleteGetController from "../controllers/TempResultControllers/tempRecommendationsDeleteGetController.js";

const router = Router();

router.delete("/:id", tempRecommendationsDeleteGetController);

export default router;
