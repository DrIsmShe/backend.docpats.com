import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

// 📌 Получаем абсолютный путь
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 📌 Директория загрузки
const UPLOADS_DIR = path.join(__dirname, "../../../server/uploads");

// 📌 Категории файлов
const FILE_CATEGORIES = {
  images: [".jpeg", ".jpg", ".png", ".gif", ".webp"],
  videos: [".mp4", ".avi", ".mov", ".mkv"],
  audio: [".mp3", ".wav", ".ogg", ".flac"],
  documents: [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"],
};

// 📌 Создаем директории, если их нет
const createUploadFolders = () => {
  if (!fs.existsSync(UPLOADS_DIR))
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  Object.keys(FILE_CATEGORIES).forEach((category) => {
    const categoryPath = path.join(UPLOADS_DIR, category);
    if (!fs.existsSync(categoryPath))
      fs.mkdirSync(categoryPath, { recursive: true });
  });

  const otherPath = path.join(UPLOADS_DIR, "other");
  if (!fs.existsSync(otherPath)) fs.mkdirSync(otherPath, { recursive: true });
};

createUploadFolders();

// 📌 Настройки `multer`
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

/**
 * 📌 Функция загрузки файла
 */
const uploadFile = async (file) => {
  if (!file) throw new Error("Файл не был загружен.");

  try {
    const ext = path.extname(file.originalname).toLowerCase();
    let category = "other";

    for (const [key, extensions] of Object.entries(FILE_CATEGORIES)) {
      if (extensions.includes(ext)) {
        category = key;
        break;
      }
    }

    const folder = path.join(UPLOADS_DIR, category);
    const fileName = `${Date.now()}-${file.originalname}`;
    const outputPath = path.join(folder, fileName);

    if (FILE_CATEGORIES.images.includes(ext)) {
      const webpFileName = fileName.replace(ext, ".webp");
      const webpPath = path.join(folder, webpFileName);
      await sharp(file.buffer)
        .resize({ width: 800 })
        .webp({ quality: 80 })
        .toFile(webpPath);
      return `/uploads/${category}/${webpFileName}`;
    }

    fs.writeFileSync(outputPath, file.buffer);
    return `/uploads/${category}/${fileName}`;
  } catch (error) {
    console.error("❌ Error processing file:", error);
    throw new Error("File processing error.");
  }
};

/**
 * 📌 Middleware для обработки массива файлов
 */
const processFiles = async (req, res, next) => {
  if (!req.files || req.files.length === 0) {
    req.uploadedFiles = [];
    return next();
  }

  try {
    req.uploadedFiles = await Promise.all(
      req.files.map(async (file) => ({
        fileName: file.originalname || "unknown_file",
        fileType: file.mimetype?.split("/")[0]?.toLowerCase() || "unknown",
        fileUrl: await uploadFile(file),
        fileSize: file.size || 0,
        fileFormat: file.mimetype || "unknown",
        studyTypeReference: "CTScan",
      }))
    );
    next();
  } catch (error) {
    res
      .status(500)
      .json({ message: "File processing error", error: error.message });
  }
};

// 📌 Экспорт всех функций
export { upload, processFiles, uploadFile };
