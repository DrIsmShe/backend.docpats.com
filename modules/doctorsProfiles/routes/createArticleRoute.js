import { Router } from "express";
import { createArticleController } from "../controllers/createArticleController.js";
import authMidleWeare from "../../../common/middlewares/authMiddleware.js";
import {
  требуетВерификации,
  ДЕЙСТВИЯ,
} from "../../../common/middlewares/requireVerifiedDoctor.js";
import {
  upload,
  resizeImage,
} from "../../../common/middlewares/uploadMiddleware.js";

const router = Router();

router.post(
  "/",
  authMidleWeare, // Проверка авторизации
  /* Публикация идёт от имени платформы: статья попадает в общий раздел,
     в карту сайта и в ленту врачам. Пока документы автора не подтверждены,
     подписывать материал его врачебным именем нельзя. */
  требуетВерификации(
    ДЕЙСТВИЯ.ПУБЛИКАЦИИ,
    "Публикация статей доступна после подтверждения документов врача.",
  ),
  upload.single("image"), // Загрузка изображения
  resizeImage, // Уменьшение изображения
  createArticleController, // Создание статьи
);

export default router;
