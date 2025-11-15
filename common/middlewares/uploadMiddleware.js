import multer from "multer";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import slugify from "slugify";

const storage = multer.memoryStorage();

const supportedImageTypes = /jpeg|jpg|png|gif|webp|bmp|tiff|svg/;
const supportedFileTypes =
  /jpeg|jpg|png|gif|webp|bmp|tiff|svg|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|zip|rar|7z|mp3|mp4|avi|mov|mkv|wav|flac|ogg|webm|jfif/;

export const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const extname = supportedFileTypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = supportedFileTypes.test(file.mimetype);
    if (extname && mimetype) cb(null, true);
    else cb(new Error("Недопустимый формат файла"));
  },
});

export const resizeImage = async (req, res, next) => {
  if (!req.file) return next();

  const isImage = supportedImageTypes.test(req.file.mimetype);
  // SVG лучше пропустить без sharp (иначе растрируется)
  if (!isImage || req.file.mimetype === "image/svg+xml") return next();

  try {
    if (!fs.existsSync("uploads")) fs.mkdirSync("uploads", { recursive: true });

    // безопасное имя (латиница, дефисы, без пробелов)
    const baseName = slugify(path.parse(req.file.originalname).name, {
      lower: true,
      strict: true,
      locale: "ru",
      trim: true,
    });

    const fileName = `${Date.now()}-${baseName}.webp`;
    const outputPath = path.join("uploads", fileName);

    await sharp(req.file.buffer)
      .resize({ width: 1200 }) // подгони под свой UI
      .webp({ quality: 82 })
      .toFile(outputPath);

    req.file.filename = fileName;
    req.file.path = outputPath;
    req.file.mimetype = "image/webp";

    return next();
  } catch (error) {
    console.error("Ошибка при обработке изображения:", error);
    return res.status(500).json({ message: "Ошибка обработки изображения" });
  }
};
