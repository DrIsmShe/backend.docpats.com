import { Router } from "express";
import updateMyarticleScientificController from "../controllers/updateMyarticleScientificController.js";
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
  updateMyarticleScientificController,
);

export default router;
