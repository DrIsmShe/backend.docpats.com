import { Router } from "express";
import tempMRIResultsController from "../controllers/TempResultControllers/tempMRIResultsController.js";
import authMidleWeare from "../../../common/middlewares/authMiddleware.js";
const router = Router();

router.post("/", authMidleWeare, tempMRIResultsController);
export default router;
