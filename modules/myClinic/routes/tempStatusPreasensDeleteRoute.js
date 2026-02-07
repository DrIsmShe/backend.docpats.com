import { Router } from "express";

import tempStatusPreasensDeleteController from "../controllers/TempResultControllers/tempStatusPreasensDeleteController.js";

const router = Router();

router.delete("/:id", tempStatusPreasensDeleteController);

export default router;
