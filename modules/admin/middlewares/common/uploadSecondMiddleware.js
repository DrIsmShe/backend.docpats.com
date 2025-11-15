import multer from "multer";
import sharp from "sharp";
import fs from "fs";
import path from "path";

// Настройка multer для временного хранения в памяти
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // Ограничение на 15 MB
  fileFilter: (req, file, cb) => {
    const fileTypes = /jpeg|jpg|png|gif|webp/;
    const extname = fileTypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = fileTypes.test(file.mimetype);

    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error("Images only!"));
    }
  },
});

// Middleware для уменьшения изображения
const resizeImage = async (req, res, next) => {
  if (!req.file) {
    return next();
  }

  try {
    // Уникальное имя файла с правильным расширением
    const fileName = `${Date.now()}-${
      path.parse(req.file.originalname).name
    }.webp`;
    const outputPath = path.join("uploads", fileName);

    // Убедимся, что папка `uploads` существует
    if (!fs.existsSync("uploads")) {
      fs.mkdirSync("uploads");
    }

    // Обработка изображения: изменение размера и конвертация
    await sharp(req.file.buffer)
      .resize({ width: 300 }) // Указываем ширину, высота подстраивается автоматически
      .webp({ quality: 80 }) // Конвертируем в формат WebP
      .toFile(outputPath);

    // Добавляем информацию об обработанном файле в запрос
    req.file.filename = fileName;
    req.file.path = outputPath;

    next();
  } catch (error) {
    console.error("Error processing image:", error);
    res.status(500).json({ message: "Error processing image" });
  }
};

export { upload, resizeImage };
