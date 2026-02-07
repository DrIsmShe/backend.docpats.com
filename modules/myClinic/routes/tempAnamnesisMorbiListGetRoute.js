import { Router } from "express";
import tempAnamnesisMorbiListGetController from "../controllers/TempResultControllers/tempAnamnesisMorbiListGetController.js";

const router = Router();

router.get("/", tempAnamnesisMorbiListGetController);

export default router;
