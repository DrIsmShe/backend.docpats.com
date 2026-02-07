import { Router } from "express";
import getMyMedicalHistoryController from "../controllers/getMyMedicalHistoryController.js";
import authMiddleware from "../../../common/middlewares/authMiddleware.js"; // обязательно!

const router = Router();

router.get("/", authMiddleware, getMyMedicalHistoryController); // ✅ добавляем промеж authMiddleware

export default router;
