import { Router } from "express";

import tempAnamnesisMorbitDeleteController from "../controllers/TempResultControllers/tempAnamnesisMorbitDeleteController.js";

const router = Router();

router.delete("/:id", tempAnamnesisMorbitDeleteController);

export default router;
