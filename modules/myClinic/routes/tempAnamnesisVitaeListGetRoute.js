import { Router } from "express";
import tempAnamnesisVitaeListGetController from "../controllers/TempResultControllers/tempAnamnesisVitaeListGetController.js";

const router = Router();

router.get("/", tempAnamnesisVitaeListGetController);

export default router;
