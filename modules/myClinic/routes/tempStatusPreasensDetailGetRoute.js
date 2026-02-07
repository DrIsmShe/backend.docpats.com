import { Router } from "express";
import tempStatusPreasensDetailGetController from "../controllers/TempResultControllers/tempStatusPreasensDetailGetController.js";

const router = Router();

router.get("/:id", tempStatusPreasensDetailGetController);

export default router;
