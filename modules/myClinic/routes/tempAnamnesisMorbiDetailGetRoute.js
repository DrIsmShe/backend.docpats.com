import { Router } from "express";
import tempAnamnesisMorbiDetailGetController from "../controllers/TempResultControllers/tempAnamnesisMorbiDetailGetController.js";

const router = Router();

router.get("/:id", tempAnamnesisMorbiDetailGetController);

export default router;
