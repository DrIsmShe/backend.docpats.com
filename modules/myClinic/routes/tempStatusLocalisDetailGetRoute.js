import { Router } from "express";
import tempStatusLocalisDetailGetController from "../controllers/TempResultControllers/tempStatusLocalisDetailGetController.js";

const router = Router();

router.get("/:id", tempStatusLocalisDetailGetController);

export default router;
