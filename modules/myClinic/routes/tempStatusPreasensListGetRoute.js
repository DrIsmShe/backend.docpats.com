import { Router } from "express";
import tempStatusPreasensListGetController from "../controllers/TempResultControllers/tempStatusPreasensListGetController.js";

const router = Router();

router.get("/", tempStatusPreasensListGetController);

export default router;
