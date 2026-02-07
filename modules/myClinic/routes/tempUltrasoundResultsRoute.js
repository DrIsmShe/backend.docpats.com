import { Router } from "express";
import tempUltrasoundResultsController from "../controllers/TempResultControllers/tempUltrasoundResultsController.js";
import authMidleWeare from "../../../common/middlewares/authMiddleware.js";
const router = Router();

router.post("/", authMidleWeare, tempUltrasoundResultsController);
export default router;
