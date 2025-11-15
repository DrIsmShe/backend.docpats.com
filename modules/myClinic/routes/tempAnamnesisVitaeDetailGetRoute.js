import { Router } from "express";
import tempAnamnesisVitaeDetailGetController from "../controllers/TempResultControllers/tempAnamnesisVitaeDetailGetController.js";

const router = Router();

router.get("/:id", tempAnamnesisVitaeDetailGetController);

export default router;
