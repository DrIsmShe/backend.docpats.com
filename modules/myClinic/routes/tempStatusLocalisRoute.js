import { Router } from "express";
import tempStatusLocalisController from "../controllers/TempResultControllers/tempStatusLocalisController.js";
import authMidleWeare from "../../../common/middlewares/authMiddleware.js";
const router = Router();

router.post("/", authMidleWeare, tempStatusLocalisController);
export default router;
