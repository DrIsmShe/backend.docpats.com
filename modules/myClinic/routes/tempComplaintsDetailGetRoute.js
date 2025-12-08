import { Router } from "express";

import tempComplaintsDetailGetController from "../controllers/TempResultControllers/tempComplaintsDetailGetController.js";

const router = Router();

router.get("/:id", tempComplaintsDetailGetController);

export default router;
