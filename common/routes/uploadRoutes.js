import express from "express";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import multer from "multer";
import { uploadFile as uploadToR2 } from "../middlewares/uploadMiddleware.js";

const router = express.Router();

// =========================
//   Multer → память
// =========================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const ok = /jpeg|jpg|png|gif|webp/.test(file.mimetype.toLowerCase());
    ok ? cb(null, true) : cb(new Error("Только изображения!"));
  },
});

// =============================
//     CKEditor universal upload
// =============================
router.post("/uploads", upload.single("upload"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        uploaded: false,
        error: { message: "Файл не найден" },
      });
    }

    // ================================
    //   Правильный PUBLIC_URL
    // ================================
    const PUBLIC_URL =
      process.env.SERVER_URL ||
      process.env.BACKEND_URL ||
      process.env.REACT_APP_API_URL ||
      "http://localhost:11000";

    const IS_PROD =
      process.env.NODE_ENV === "production" ||
      process.env.FILE_STORAGE === "r2";

    // ================================
    //   PROD: UPLOAD → R2
    // ================================
    if (IS_PROD) {
      const url = await uploadToR2(req.file);

      return res.status(201).json({
        uploaded: true,
        url: url, // <── CKEditor читает ТОЛЬКО url
      });
    }

    // ================================
    //   DEV: LOCAL UPLOAD
    // ================================
    const uploadsDir = "uploads";
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Генерация корректного имени файла
    const safeName = `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.webp`;

    const outputPath = path.join(uploadsDir, safeName);

    // Сжатие и сохранение
    await sharp(req.file.buffer)
      .resize({ width: 1200 })
      .webp({ quality: 82 })
      .toFile(outputPath);

    return res.status(201).json({
      uploaded: true,
      url: `${PUBLIC_URL.replace(/\/$/, "")}/uploads/${safeName}`,
    });
  } catch (err) {
    console.error("❌ Ошибка загрузки:", err);
    return res.status(500).json({
      uploaded: false,
      error: { message: err.message },
    });
  }
});

export default router;
