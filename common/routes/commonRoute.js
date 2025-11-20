import { Router } from "express";
import multer from "multer";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import articlesAllController from "../../controllers/common/articlesAllController.js";
import { uploadPDF, getPDF } from "../middlewares/uploadPdfFileMiddleWere.js";

const router = Router();

// === Получение всех статей ===
router.get("/articles", articlesAllController);

// === Загрузка PDF-файлов ===
router.post("/upload/pdf", uploadPDF);
router.get("/get-pdf/:fileName", getPDF);

// === Загрузка изображений ===
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

    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error("Только изображения!"));
    }
  },
});

router.post("/upload/image", imageUpload.single("upload"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "Файл не найден" });
  }

  try {
    const fileName = `${Date.now()}-${
      path.parse(req.file.originalname).name
    }.webp`;
    const outputPath = path.join("uploads", fileName);

    if (!fs.existsSync("uploads")) {
      fs.mkdirSync("uploads");
    }

    await sharp(req.file.buffer)
      .resize({ width: 800 }) // Уменьшаем размер до 800px
      .webp({ quality: 80 }) // Конвертируем в формат WebP
      .toFile(outputPath);

    res.status(201).json({
      uploaded: true,
      url: `http://localhost:11000/uploads/${fileName}`,
    });
  } catch (error) {
    console.error("Ошибка загрузки файла:", error);
    res.status(500).json({ message: "Ошибка загрузки файла" });
  }
});

export default router;
