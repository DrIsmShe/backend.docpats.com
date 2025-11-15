import { Router } from "express";
import tempAnamnesisMorbiController from "../controllers/TempResultControllers/tempAnamnesisMorbiController.js";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";

const router = Router();

router.post("/", authMiddleware, tempAnamnesisMorbiController);

export default router;
