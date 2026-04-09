import { Router } from "express";
import { createArticleScientificController } from "../controllers/createArticleScientificController.js";
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
  createArticleScientificController, // Создание статьи
);

export default router;
