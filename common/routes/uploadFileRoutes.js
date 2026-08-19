import { Router } from "express";
import multer from "multer";
import { upload, uploadFile, getPDF } from "../middlewares/uploadMiddleware.js";
import requireSession from "../middlewares/requireSession.js";
import adminRoute from "../../modules/admin/routes/adminRoute.js";
const router = Router();

// Ошибки multer (не то поле, слишком большой файл, запрещённый тип) — это
// ошибки запроса, а не сервера. Без этой обёртки они уходили в глобальный
// errorHandler и возвращались как 500 без текста: именно поэтому опечатка в
// имени поля на клиенте месяцами читалась как «сервер сломался».
const acceptPdf = (req, res, next) =>
  upload.single("pdf")(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      return res.status(400).json({
        message:
          err.code === "LIMIT_UNEXPECTED_FILE"
            ? `Файл должен приходить в поле "pdf" (получено "${err.field}")`
            : err.message,
        code: err.code,
      });
    }
    return res.status(400).json({ message: err.message });
  });

// Загрузка доступна только аутентифицированным: роут кладёт файл в R2 и
// возвращает публичную ссылку, то есть без гарда это открытая запись в наше
// хранилище для кого угодно из интернета.
router.post("/upload", requireSession, acceptPdf, async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "PDF not found" });

  try {
    const url = await uploadFile(req.file);
    res.status(201).json({ uploaded: true, url });
  } catch (e) {
    console.error("❌ /api/upload:", e);
    res.status(500).json({ error: e.message });
  }
});

// Чтение — обратная сторона той же дыры: по этому роуту отдаются выписки и
// результаты исследований, то есть PHI.
router.get("/get-pdf/:fileName", requireSession, getPDF);

router.use("/admin", adminRoute);
export default router;
