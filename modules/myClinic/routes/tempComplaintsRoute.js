import { Router } from "express";
import tempComplaintsController from "../controllers/TempResultControllers/tempComplaintsController.js";
import authMidleWeare from "../../../common/middlewares/authMiddleware.js";
const router = Router();

router.post("/", authMidleWeare, tempComplaintsController);
export default router;
