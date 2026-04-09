import { Router } from "express";
import addPrivatePatientPolyclinicController from "../../myClinic/controllers/addPrivatePatientPolyclinicController.js";
import authMidleWeare from "../../../common/middlewares/authMiddleware.js";
import {
  upload,
  resizeImage,
} from "../../../common/middlewares/uploadMiddleware.js";
import requireDoctorPatientLimit from "../../../common/middlewares/requireDoctorPatientLimit.js";
const router = Router();

router.post(
  "/",
  authMidleWeare, // Проверка авторизации
  requireDoctorPatientLimit, // 💎 ЛИМИТ ПАЦИЕНТОВ
  upload.single("image"), // Загрузка изображения
  resizeImage, // Уменьшение изображения
  addPrivatePatientPolyclinicController, // Контроллер для добавления пациента
);

export default router;
