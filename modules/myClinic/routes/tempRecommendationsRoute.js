import { Router } from "express";
import tempRecommendationsController from "../controllers/TempResultControllers/tempRecommendationsController.js";
import authMidleWeare from "../../../common/middlewares/authMiddleware.js";
const router = Router();

router.post("/", authMidleWeare, tempRecommendationsController);
export default router;
