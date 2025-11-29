import { Router } from "express";
import addPatientPolyclinicController from "../controllers/addPatientPolyclinicController.js";
import authMidleWeare from "../../../common/middlewares/authMiddleware.js";
import {
  upload,
  resizeImage,
} from "../../../common/middlewares/uploadMiddleware.js";

const router = Router();

router.post(
  "/",
  authMidleWeare, // Проверка авторизации
  upload.single("image"), // Загрузка изображения
  resizeImage, // Уменьшение изображения
  addPatientPolyclinicController // Контроллер для добавления пациента
);

export default router;
