// server/modules/labInsight/index.js
// ─────────────────────────────────────────────────────────────────────
//   Расшифровка анализов ДЛЯ ПАЦИЕНТА.
//
//   Монтируется в index.js как /api/v1/lab-insight, ПОСЛЕ
//   session-middleware: весь модуль опирается на req.session.userId и
//   без него не имеет смысла — разбор принадлежит конкретному человеку.
//
//   Устройство модуля описано в services/labInsight.service.js; коротко:
//   модель переписывает бланк, программа считает отклонения, модель
//   объясняет уже посчитанное. Судить о том, что тревожно, доверено
//   арифметике, а не модели, — единственный вывод, который пациент
//   проверить не может, должен быть проверяемым по построению.
// ─────────────────────────────────────────────────────────────────────

import express from "express";
import multer from "multer";
import {
  ALLOWED_MIME,
  MAX_FILE_BYTES,
} from "../diagnostics/ai/documentReader.js";
import * as ctrl from "./controllers/labInsight.controller.js";

const router = express.Router();

// Авторизация: разбор принадлежит человеку, анонимного варианта нет.
// Отдельный guard, а не общий requireAuth, потому что модулю нужен
// именно userId, а не роль.
function requireUser(req, res, next) {
  if (!req.session?.userId) {
    return res
      .status(401)
      .json({ success: false, message: "Требуется вход в аккаунт" });
  }
  next();
}

// memoryStorage: фотография бланка не должна пережить запрос. Она не
// пишется ни на диск, ни в R2 — в базу попадают только показатели.
// Бланк это ФИО, дата рождения и номер карты; хранилища, которого нет,
// не существует и для утечки.
//
// Предел размера дублирует проверку в labSheetReader намеренно: multer
// отказывает до того, как файл целиком окажется в памяти, а reader — до
// того, как он уйдёт в модель. Это разные рубежи.
const sheetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) return cb(null, true);
    cb(new Error(`Формат ${file.mimetype} не поддерживается`));
  },
});

router.use(requireUser);

router.get("/quota", ctrl.quotaController);
router.get("/", ctrl.listController);
router.post("/", sheetUpload.single("file"), ctrl.createController);
router.get("/:id", ctrl.getController);
router.delete("/:id", ctrl.deleteController);

export default router;
