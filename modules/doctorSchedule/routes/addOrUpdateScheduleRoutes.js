import express from "express";
import { addOrUpdateScheduleController } from "../controllers/addOrUpdateScheduleController.js";
import authMiddleware from "../../../common/middlewares/authvalidateMiddleware/authMiddleware.js";

const router = express.Router();
router.post("/update", authMiddleware, addOrUpdateScheduleController);

export default router;
