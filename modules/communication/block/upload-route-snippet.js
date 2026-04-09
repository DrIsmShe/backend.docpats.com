// Добавить в communicationRoutes.js (или отдельный файл)
// Этот роут принимает один файл и возвращает fileUrl

import { upload, uploadFile } from "../middleware/uploadMiddleware.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

// POST /api/communication/upload
router.post(
  "/upload",
  authMiddleware,
  upload.single("file"), // multer — один файл
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "Файл не передан" });
      }

      // uploadFile уже делает: compress images, upload to R2 or local, returns URL
      const fileUrl = await uploadFile(req.file);

      return res.json({
        fileUrl,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        fileFormat: req.file.mimetype,
        fileType: req.file.mimetype.split("/")[0], // "image" | "video" | "audio" | "application"
      });
    } catch (err) {
      console.error("Chat upload error:", err);
      return res
        .status(500)
        .json({ message: err.message || "Ошибка загрузки файла" });
    }
  },
);
