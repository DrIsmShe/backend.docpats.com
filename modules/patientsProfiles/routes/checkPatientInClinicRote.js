// server/modules/.../routes/checkPatientInClinicRoute.js
import { Router } from "express";
import checkPatientInClinicController from "../controllers/checkPatientInClinicController.js";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";

const router = Router();

// Без params, только авторизованный пользователь проверяет себя
router.get("/", authMiddleware, checkPatientInClinicController);

export default router;
