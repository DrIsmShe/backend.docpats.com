import { Router } from "express";
import tempStatusPreasensController from "../controllers/TempResultControllers/tempStatusPreasensController.js";
import authMidleWeare from "../../../common/middlewares/authMiddleware.js";
const router = Router();

router.post("/", authMidleWeare, tempStatusPreasensController);
export default router;
