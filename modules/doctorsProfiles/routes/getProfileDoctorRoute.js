import { Router } from "express";
import authMiddleware from "../../../common/middlewares/authvalidateMiddleware/authMiddleware.js";
import getProfileDoctorController from "../controllers/getProfileDoctorController.js";

const router = Router();

// Маршрут без параметра userId, защищённый аутентификацией
router.get("/:userId", authMiddleware, getProfileDoctorController);

export default router;
