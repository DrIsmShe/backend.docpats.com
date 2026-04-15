import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import authMiddleware from "../../common/middlewares/authvalidateMiddleware/authMiddleware.js";
import * as ctrl from "./surgicalCase.controller.js";

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Папка для фото ────────────────────────────────────────────────────────
const surgeryUploads = path.join(__dirname, "../../uploads/surgery");
if (!fs.existsSync(surgeryUploads))
  fs.mkdirSync(surgeryUploads, { recursive: true });

// ─── Multer ────────────────────────────────────────────────────────────────
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic"];
const MAX_SIZE_MB = 20;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, surgeryUploads),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    ALLOWED_MIME.includes(file.mimetype)
      ? cb(null, true)
      : cb(
          new Error(
            `Недопустимый тип файла. Разрешены: ${ALLOWED_MIME.join(", ")}`,
          ),
          false,
        ),
});

// ─── Валидация label фото ──────────────────────────────────────────────────
const VALID_LABELS = [
  "before",
  "after",
  "intra_op",
  "1week",
  "1month",
  "3months",
  "6months",
  "simulation",
];
function validatePhotoLabel(req, res, next) {
  const { label } = req.body;
  if (label && !VALID_LABELS.includes(label)) {
    return res
      .status(400)
      .json({
        success: false,
        error: `Invalid label. Use one of: ${VALID_LABELS.join(", ")}`,
      });
  }
  next();
}

// ──────────────────────────────────────────────────────────────────────────
// ПУБЛИЧНЫЕ РОУТЫ (без auth)
// ──────────────────────────────────────────────────────────────────────────
router.get("/public", ctrl.getPublicCases);

// ──────────────────────────────────────────────────────────────────────────
// ЗАЩИЩЁННЫЕ РОУТЫ
// ──────────────────────────────────────────────────────────────────────────
router.use(authMiddleware);

// Статистика
router.get("/stats", ctrl.getStats);

// ──────────────────────────────────────────────────────────────────────────
// ВАЖНО: специфичные роуты ОБЯЗАТЕЛЬНО до /:id
// ──────────────────────────────────────────────────────────────────────────

// Список кейсов / создание
router.get("/cases", ctrl.listCases);
router.post("/cases", ctrl.createCase);

// Кейсы конкретного пациента — ДОЛЖЕН БЫТЬ ДО /cases/:id
router.get("/cases/by-patient", ctrl.getCasesByPatient);

// ──────────────────────────────────────────────────────────────────────────
// РОУТЫ С ПАРАМЕТРОМ :id
// ──────────────────────────────────────────────────────────────────────────
router.get("/cases/:id", ctrl.getCase);
router.put("/cases/:id", ctrl.updateCase);
router.delete("/cases/:id", ctrl.deleteCase);

// Фото
router.post(
  "/cases/:id/photos",
  upload.single("photo"),
  validatePhotoLabel,
  ctrl.addPhoto,
);
router.delete("/cases/:id/photos/:photoId", ctrl.removePhoto);

// Follow-up
router.post("/cases/:id/followup", ctrl.addFollowUp);

// Оценка результата
router.put("/cases/:id/outcome", ctrl.setOutcome);

// Публикация
router.put("/cases/:id/publish", ctrl.togglePublish);

// PDF
router.get("/cases/:id/pdf", ctrl.downloadPDF);

// ─── Ошибки multer ────────────────────────────────────────────────────────
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res
        .status(400)
        .json({
          success: false,
          error: `Файл слишком большой. Максимум ${MAX_SIZE_MB}MB`,
        });
    }
    return res.status(400).json({ success: false, error: err.message });
  }
  if (err?.message?.includes("Недопустимый тип")) {
    return res.status(400).json({ success: false, error: err.message });
  }
  next(err);
});

export default router;
