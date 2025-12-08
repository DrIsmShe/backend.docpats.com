import multer from "multer";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import slugify from "slugify";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";

// ============================================================
//       Cloudflare R2 CONFIG (используется только в продакшене)
// ============================================================
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET;

// ============================================================
//             FULL LIST OF SUPPORTED FILE TYPES
// ============================================================
const ALLOWED_TYPES =
  /jpeg|jpg|png|gif|webp|bmp|tiff|svg|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|zip|rar|7z|mp3|mp4|avi|mov|mkv|wav|flac|ogg|webm|jfif/;

// ============================================================
//                      LOCAL STORAGE (DEV)
// ============================================================
const localUploadDir = "uploads";

if (!fs.existsSync(localUploadDir)) {
  fs.mkdirSync(localUploadDir, { recursive: true });
}

// ============================================================
//                  MULTER (always memory buffer)
// ============================================================
const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const ok = ALLOWED_TYPES.test(ext) && ALLOWED_TYPES.test(file.mimetype);

    if (ok) cb(null, true);
    else cb(new Error("Недопустимый формат файла"), false);
  },
});

// ============================================================
//             DETECT CATEGORY BY FILE EXTENSION
// ============================================================
const detectCategory = (filename) => {
  const ext = path.extname(filename).toLowerCase();

  if (/(jpeg|jpg|png|gif|webp|bmp|tiff|svg)/.test(ext)) return "images";
  if (/(mp4|mov|avi|mkv|webm)/.test(ext)) return "videos";
  if (/(mp3|wav|flac|ogg)/.test(ext)) return "audio";

  return "documents";
};

// ============================================================
//                   UPLOAD TO CLOUDFLARE R2
// ============================================================
const uploadToR2 = async (buffer, key, contentType) => {
  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ACL: "public-read",
    })
  );

  return `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET}/${key}`;
};

// ============================================================
//       UNIVERSAL uploadFile FUNCTION (prod → R2, dev → local)
// ============================================================
export const uploadFile = async (file) => {
  if (!file) throw new Error("Файл не найден");

  const ext = path.extname(file.originalname).toLowerCase();
  const category = detectCategory(file.originalname);

  const unique = crypto.randomUUID();
  let key = `uploads/${category}/${unique}${ext}`;

  // ================
  //  IF PRODUCTION → R2
  // ================
  if (
    process.env.NODE_ENV === "production" ||
    process.env.FILE_STORAGE === "r2"
  ) {
    let buffer = file.buffer;
    let contentType = file.mimetype;

    // Images → convert to WebP before uploading
    if (category === "images" && ext !== ".svg") {
      buffer = await sharp(file.buffer)
        .resize({ width: 1200 })
        .webp({ quality: 82 })
        .toBuffer();

      key = `uploads/images/${unique}.webp`;
      contentType = "image/webp";
    }

    return await uploadToR2(buffer, key, contentType);
  }

  // ================
  //  IF DEVELOPMENT → LOCAL
  // ================
  if (!fs.existsSync(localUploadDir)) {
    fs.mkdirSync(localUploadDir, { recursive: true });
  }

  const safeName = slugify(path.parse(file.originalname).name, { lower: true });
  const localName = `${Date.now()}-${safeName}.webp`;
  const outputPath = path.join(localUploadDir, localName);

  await sharp(file.buffer)
    .resize({ width: 1200 })
    .webp({ quality: 82 })
    .toFile(outputPath);

  return `${process.env.REACT_APP_API_URL}/uploads/${localName}`;
};

// ============================================================
//         PROCESS MULTIPLE FILES → req.uploadedFiles[]
// ============================================================
export const processFiles = async (req, res, next) => {
  if (!req.files || req.files.length === 0) {
    req.uploadedFiles = [];
    return next();
  }

  try {
    req.uploadedFiles = await Promise.all(
      req.files.map(async (file) => ({
        fileName: file.originalname,
        fileType: file.mimetype.split("/")[0],
        fileUrl: await uploadFile(file),
        fileSize: file.size,
        fileFormat: file.mimetype,
        studyTypeReference: "CTScan",
      }))
    );

    next();
  } catch (err) {
    res.status(500).json({ message: "File upload error", error: err.message });
  }
};

// ============================================================
//             PDF GET route (supports local + R2)
// ============================================================
export const getPDF = async (req, res) => {
  const fileName = req.params.fileName;

  // --- R2 MODE ---
  if (
    process.env.NODE_ENV === "production" ||
    process.env.FILE_STORAGE === "r2"
  ) {
    try {
      const key = `uploads/documents/${fileName}`;
      const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
      const data = await r2.send(command);

      res.setHeader("Content-Type", "application/pdf");
      data.Body.pipe(res);
    } catch (error) {
      res.status(404).json({ message: "PDF not found", error: error.message });
    }
    return;
  }

  // --- LOCAL MODE ---
  const filePath = path.join(localUploadDir, fileName);
  if (fs.existsSync(filePath)) res.sendFile(path.resolve(filePath));
  else res.status(404).json({ message: "Файл не найден" });
};
// ============================================================
//      Legacy wrapper: uploadPDF (чтобы не ломать старые роуты)
// ============================================================
export const uploadPDF = (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) {
      return res.status(500).json({
        message: "Ошибка загрузки PDF",
        error: err.message,
      });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ message: "Файл не получен" });
      }

      const pdfUrl = await uploadFile(req.file);

      res.json({
        message: "PDF успешно загружен",
        fileUrl: pdfUrl,
      });
    } catch (e) {
      res.status(500).json({
        message: "Ошибка обработки PDF",
        error: e.message,
      });
    }
  });
};
