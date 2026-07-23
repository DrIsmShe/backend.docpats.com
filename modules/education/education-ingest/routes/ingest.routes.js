// server/modules/education/education-ingest/routes/ingest.routes.js
//
// Загрузка файла идёт через СВОЙ multer с memoryStorage, а не через общий
// common/middlewares/uploadMiddleware.js. Причины:
//   - общий загрузчик прогоняет изображения через sharp и кладёт всё в R2;
//     нам не нужно ни то, ни другое — исходник мы намеренно не храним;
//   - PDF в общем пайплайне обрабатывается отдельной веткой, и смешивать
//     сюда его логику значит тащить чужие ограничения.

import express from "express";
import multer from "multer";
import * as ctrl from "../controllers/ingest.controller.js";
import { requireAuthor } from "../../middlewares/educationAuth.js";
import { isSupportedFile } from "../extractors/fileTypes.js";
import { ValidationError } from "../../../../common/utils/errors.js";

const router = express.Router();

// 25 МБ: чуть выше лимита экстрактора, чтобы «слишком большой файл»
// сообщал сервис с внятным текстом, а не multer сухим кодом.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    // Проверяем по MIME И по имени: браузерному типу верить нельзя, а
    // отказывать по нему — значит отбрасывать нормальные .csv и .md.
    if (!isSupportedFile({ mimeType: file.mimetype, fileName: file.originalname })) {
      // ValidationError, а не голый Error: иначе errorHandler отдаст 500,
      // и админ увидит «внутренняя ошибка» вместо причины отказа.
      return cb(
        new ValidationError(
          `Неподдерживаемый файл: ${file.originalname}. ` +
            "Принимаются PDF, изображения, Word (.docx) и текстовые файлы (TXT, MD, CSV, HTML, RTF).",
        ),
      );
    }
    cb(null, true);
  },
});

// Ошибки самого multer (превышен размер, лишние поля) приходят как
// MulterError и без этой обёртки тоже улетели бы в 500.
function uploadSingle(field) {
  return (req, res, next) => {
    upload.single(field)(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return next(
            new ValidationError(
              "Файл больше 25 МБ. Разбейте его на части или сожмите PDF.",
            ),
          );
        }
        return next(new ValidationError(`Ошибка загрузки файла: ${err.message}`));
      }
      next(err);
    });
  };
}

router.get("/import/extractors", requireAuthor, ctrl.listExtractorsController);

router.get("/import/jobs", requireAuthor, ctrl.listJobsController);
router.post("/import/jobs", requireAuthor, ctrl.createJobController);
// Генерация вопросов моделью по теме — своё задание, без файла.
router.post("/import/generate", requireAuthor, ctrl.generateController);
router.get("/import/jobs/:id", requireAuthor, ctrl.getJobController);
router.delete("/import/jobs/:id", requireAuthor, ctrl.deleteJobController);

router.post(
  "/import/jobs/:id/run",
  requireAuthor,
  uploadSingle("file"),
  ctrl.runExtractionController,
);

router.patch(
  "/import/jobs/:id/drafts/:index",
  requireAuthor,
  ctrl.updateDraftController,
);

router.post(
  "/import/jobs/:id/import",
  requireAuthor,
  ctrl.importDraftsController,
);

export default router;
