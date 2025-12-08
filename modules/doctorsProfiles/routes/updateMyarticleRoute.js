import { Router } from "express";
import updateMyArticleController from "../controllers/updateMyArticleController.js";
import authMidleWeare from "../../../common/middlewares/authMiddleware.js";
import {
  upload,
  resizeImage,
} from "../../../common/middlewares/uploadMiddleware.js";

const router = Router();

router.put(
  "/:id",
  authMidleWeare, // Проверка авторизации
  upload.single("image"), // Загрузка изображения
  resizeImage, // Уменьшение изображения
  updateMyArticleController
);

export default router;
