import { Router } from "express";
import tempStatusLocalisListGetController from "../controllers/TempResultControllers/tempStatusLocalisListGetController.js";

const router = Router();

router.get("/", tempStatusLocalisListGetController);

export default router;
