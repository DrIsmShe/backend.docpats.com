import { Router } from "express";

import tempAnamnesisVitaeDeleteController from "../controllers/TempResultControllers/tempAnamnesisVitaeDeleteController.js";

const router = Router();

router.delete("/:id", tempAnamnesisVitaeDeleteController);

export default router;
