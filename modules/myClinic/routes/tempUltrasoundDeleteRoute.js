import { Router } from "express";

import tempUltrasoundDeleteController from "../controllers/TempResultControllers/tempUltrasoundDeleteController.js";

const router = Router();

router.delete("/:id", tempUltrasoundDeleteController);

export default router;
