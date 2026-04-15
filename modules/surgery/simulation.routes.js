import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import authMiddleware from "../../common/middlewares/authvalidateMiddleware/authMiddleware.js";
import * as ctrl from "./simulation.controller.js";

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const maskDir = path.join(__dirname, "../../uploads/surgery");
if (!fs.existsSync(maskDir)) fs.mkdirSync(maskDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, maskDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".png";
    cb(null, `mask-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    ["image/png", "image/jpeg", "image/webp"].includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error("Только PNG/JPEG/WEBP"));
  },
});

router.use(authMiddleware);

// Получить список промптов для процедуры
router.get("/prompts/:procedure", ctrl.getPrompts);

// Запустить симуляцию
router.post("/cases/:id/simulate", upload.single("mask"), ctrl.startSimulation);

// Получить симуляции кейса
router.get("/cases/:id/simulations", ctrl.getSimulations);

// Выбрать вариант
router.put("/simulations/:simId/select", ctrl.selectResult);

// Удалить симуляцию
router.delete("/simulations/:simId", ctrl.deleteSimulation);

export default router;
