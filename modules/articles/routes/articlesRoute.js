import { Router } from "express";
import multer from "multer";
import sharp from "sharp";
import fs from "fs";
import path from "path";

import articlesAllController from "../controllers/articlesAllController.js";
import createArticleController from "../controllers/createArticleController.js";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";

import {
  upload,
  resizeImage,
} from "../../../common/middlewares/uploadMiddleware.js";
import {
  uploadPDF,
  getPDF,
} from "../../../common/middlewares/uploadPdfFileMiddleWere.js";

const router = Router();

/**
 * === Получение всех статей ===
 */
router.get("/", articlesAllController);

/**
 * === Создание статьи ===
 */
router.post(
  "/",
  authMiddleware, // Проверка авторизации
  upload.single("image"), // Загрузка изображения
  resizeImage, // Уменьшение изображения и сохранение
  createArticleController // Создание статьи
);

/**
 * === Загрузка PDF-файлов ===
 */
router.post("/upload", uploadPDF);
router.get("/get-pdf/:fileName", getPDF);

/**
 * === Прямая загрузка изображений (например, для редактора) ===
 */
const storage = multer.memoryStorage();

const imageUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // Ограничение 10 MB
  fileFilter: (req, file, cb) => {
    const fileTypes = /jpeg|jpg|png|gif|webp/;
    const extname = fileTypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = fileTypes.test(file.mimetype);

    if (extname && mimetype) cb(null, true);
    else cb(new Error("Разрешены только изображения!"));
  },
});

router.post("/uploads", imageUpload.single("upload"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "Файл не найден" });
  }

  try {
    const uploadsDir = path.resolve("uploads");
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

    const fileName = `${Date.now()}-${
      path.parse(req.file.originalname).name
    }.webp`;
    const outputPath = path.join(uploadsDir, fileName);

    await sharp(req.file.buffer)
      .resize({ width: 800 }) // уменьшаем размер
      .webp({ quality: 80 }) // конвертируем в WebP
      .toFile(outputPath);

    res.status(201).json({
      uploaded: true,
      url: `http://localhost:11000/uploads/${fileName}`,
    });
  } catch (error) {
    console.error("❌ Ошибка загрузки изображения:", error);
    res.status(500).json({ message: "Ошибка загрузки файла" });
  }
});

export default router;
