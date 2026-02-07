import { Router } from "express";
import addPatientsPolyclinicMedicalHistoryController from "../controllers/addPatientsPolyclinicMedicalHistoryController.js";
import authMidleWeare from "../../../common/middlewares/authMiddleware.js";
import {
  upload,
  resizeImage,
} from "../../../common/middlewares/uploadMiddleware.js";

const router = Router();

router.post(
  "/:id",
  authMidleWeare, // Проверка авторизации
  upload.single("image"), // Загрузка изображения
  resizeImage, // Уменьшение изображения
  addPatientsPolyclinicMedicalHistoryController
);
export default router;
