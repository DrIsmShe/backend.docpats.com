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
import r2 from "../services/r2Client.js";

// ============================================================
//                SETTINGS
// ============================================================

const IS_R2 =
  process.env.NODE_ENV === "production" || process.env.FILE_STORAGE === "r2";

const LOCAL_DIR = "uploads";

if (!IS_R2 && !fs.existsSync(LOCAL_DIR)) {
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
}

// ============================================================
//             CLOUDLFARE R2 FIXED CLIENT
// ============================================================

const BUCKET = process.env.R2_BUCKET;

// ============================================================
//          FULL LIST OF ALLOWED FILE TYPES
// ============================================================

const ALLOWED =
  /jpeg|jpg|png|gif|webp|bmp|tiff|svg|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|zip|rar|7z|mp3|mp4|avi|mov|mkv|wav|flac|ogg|webm|jfif/;

const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: { fileSize: 150 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED.test(ext) && ALLOWED.test(file.mimetype)) cb(null, true);
    else cb(new Error("Недопустимый тип файла"));
  },
});

// ============================================================
//          CATEGORY DETECTOR
// ============================================================

const getCategory = (filename) => {
  const ext = path.extname(filename).toLowerCase();
  if (/(jpeg|jpg|png|gif|webp|bmp|tiff|svg)/.test(ext)) return "images";
  if (/(mp4|mov|avi|mkv|webm)/.test(ext)) return "videos";
  if (/(mp3|wav|flac|ogg)/.test(ext)) return "audio";
  return "documents";
};

// ============================================================
//       DETECT STUDY TYPE (Enum-Safe)
// ============================================================

const detectStudyType = (req) => {
  const url = req.originalUrl.toLowerCase();

  if (url.includes("ct-scan")) return "CTScan";
  if (url.includes("mri-scan")) return "MRIScan";
  if (url.includes("usm-scan")) return "USMScan";
  if (url.includes("xray-scan")) return "XRAYScan";
  if (url.includes("pet-scan")) return "PETScan";
  if (url.includes("spect-scan")) return "SPECTScan";
  if (url.includes("eeg-scan")) return "EEGScan";
  if (url.includes("ginecology-test")) return "GinecologyScan";
  if (url.includes("holter-scan")) return "HOLTERScan";
  if (url.includes("spirometry-scan")) return "SpirometryScan";
  if (url.includes("dopler-scan")) return "DoplerScan";
  if (url.includes("gastroscopy-scan")) return "GastroscopyScan";
  if (url.includes("capsuleendoscopy-scan")) return "CapsuleEndoscopy";
  if (url.includes("angiography-scan")) return "AngiographyScan";
  if (url.includes("ekg-scan") && !url.includes("echo")) return "EKGScan";
  if (url.includes("echo-ekg-scan")) return "EchoEKGScan";
  if (url.includes("coronography-scan")) return "CoronographyScan";
  if (url.includes("labtest-scan")) return "LabTest";

  return "other";
};

// ============================================================
//          PUBLIC URL BUILDER (CORE FIX)
// ============================================================

const resolvePublicURL = () => {
  return (
    process.env.SERVER_URL?.trim() ||
    process.env.BACKEND_URL?.trim() ||
    process.env.REACT_APP_API_URL?.trim() ||
    "http://localhost:11000"
  );
};

// ============================================================
//            UPLOAD FILE (R2 + DEV)
// ============================================================

export const uploadFile = async (file) => {
  if (!file) throw new Error("Файл отсутствует");

  const PUBLIC_URL = resolvePublicURL();
  const ext = path.extname(file.originalname).toLowerCase();
  const category = getCategory(file.originalname);
  const unique = crypto.randomUUID();

  let buffer = file.buffer;
  let finalExt = ext;
  let contentType = file.mimetype;

  // compress images
  if (category === "images" && ext !== ".svg") {
    buffer = await sharp(file.buffer)
      .resize({ width: 1600 })
      .webp({ quality: 82 })
      .toBuffer();

    finalExt = ".webp";
    contentType = "image/webp";
  }

  const key = `uploads/${category}/${unique}${finalExt}`;

  if (IS_R2) {
    await r2.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );

    // 🔥 Возвращаем ПУБЛИЧНЫЙ URL, который реально работает
    return `${process.env.R2_PUBLIC_URL}/${key}`;
  }

  // ---------------- DEV MODE ----------------
  const safeName = `${Date.now()}-${slugify(unique)}${finalExt}`;
  const filePath = path.join(LOCAL_DIR, safeName);
  await fs.promises.writeFile(filePath, buffer);

  return `${PUBLIC_URL}/uploads/${safeName}`;
};

// ============================================================
//          PROCESS MULTIPLE FILES
// ============================================================

export const processFiles = async (req, res, next) => {
  if (!req.files || req.files.length === 0) {
    req.uploadedFiles = [];
    return next();
  }

  try {
    const studyTypeReference = detectStudyType(req);

    req.uploadedFiles = await Promise.all(
      req.files.map(async (file) => ({
        fileName: file.originalname,
        fileType: file.mimetype.split("/")[0],
        fileUrl: await uploadFile(file),
        fileSize: file.size,
        fileFormat: file.mimetype,
        studyTypeReference,
      }))
    );

    next();
  } catch (err) {
    console.error("🔥 ERROR in processFiles:", err);
    res.status(500).json({ message: "File upload error", error: err.message });
  }
};

// ============================================================
//                CKEditor Upload
// ============================================================

export const uploadImageForCKEditor = async (req, res) => {
  try {
    const file = req.file;
    const url = await uploadFile(file);
    res.json({ uploaded: true, url });
  } catch (err) {
    res.status(500).json({ uploaded: false, error: err.message });
  }
};

// ============================================================
//                PDF download
// ============================================================

export const getPDF = async (req, res) => {
  const fileName = req.params.fileName;

  if (IS_R2) {
    try {
      const key = `uploads/documents/${fileName}`;
      const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
      const data = await r2.send(command);
      res.setHeader("Content-Type", "application/pdf");
      return data.Body.pipe(res);
    } catch (e) {
      return res
        .status(404)
        .json({ message: "PDF not found", error: e.message });
    }
  }

  const filePath = path.join(LOCAL_DIR, fileName);
  if (fs.existsSync(filePath)) return res.sendFile(path.resolve(filePath));

  res.status(404).json({ message: "Файл не найден" });
};

//                Image Resize (unused but kept)
// ============================================================
export const resizeImage = async (req, res, next) => {
  if (!req.file) return next();

  const isImage = /jpeg|jpg|png|gif|webp|bmp|tiff|svg/.test(req.file.mimetype);

  if (!isImage || req.file.mimetype === "image/svg+xml") return next();

  try {
    const baseName = slugify(path.parse(req.file.originalname).name, {
      lower: true,
      strict: true,
      locale: "ru",
      trim: true,
    });

    const fileName = `${Date.now()}-${baseName}.webp`;

    const webpBuffer = await sharp(req.file.buffer)
      .resize({ width: 1200 })
      .webp({ quality: 82 })
      .toBuffer();

    req.file.buffer = webpBuffer;
    req.file.originalname = fileName;
    req.file.mimetype = "image/webp";

    return next();
  } catch (error) {
    console.error("Ошибка при обработке изображения:", error);
    return res.status(500).json({ message: "Ошибка обработки изображения" });
  }
};
