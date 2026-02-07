import { Router } from "express";
import tempAnamnesisVitaeController from "../controllers/TempResultControllers/tempAnamnesisVitaeController.js";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";

const router = Router();

router.post("/", authMiddleware, tempAnamnesisVitaeController);

export default router;
