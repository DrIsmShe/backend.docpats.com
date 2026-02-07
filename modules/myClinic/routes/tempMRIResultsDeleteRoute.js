import { Router } from "express";

import tempMRResultsDeleteController from "../controllers/TempResultControllers/tempMRResultsDeleteController.js";

const router = Router();

router.delete("/:id", tempMRResultsDeleteController);

export default router;
