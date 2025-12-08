import { Router } from "express";

import tempStatusLocalisDeleteController from "../controllers/TempResultControllers/tempStatusLocalisDeleteController.js";

const router = Router();

router.delete("/:id", tempStatusLocalisDeleteController);

export default router;
