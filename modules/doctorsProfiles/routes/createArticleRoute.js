import { Router } from "express";
import { createArticleController } from "../controllers/createArticleController.js";
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
  createArticleController // Создание статьи
);

export default router;
