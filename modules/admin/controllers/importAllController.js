import multer from "multer";
import mongoose from "mongoose";

const upload = multer({ storage: multer.memoryStorage() });

// Middleware для multer — используй в роуте:
// router.post("/import-all", authMiddleware, upload.single("file"), importAllController);

export const importAllController = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Файл не передан" });
    }

    let data;
    try {
      data = JSON.parse(req.file.buffer.toString("utf-8"));
    } catch {
      return res.status(400).json({ error: "Невалидный JSON" });
    }

    // Ожидаем формат: { collectionName: [...documents], ... }
    if (typeof data !== "object" || Array.isArray(data)) {
      return res
        .status(400)
        .json({ error: "Ожидается объект { collectionName: [...] }" });
    }

    const db = mongoose.connection.db;
    const imported = {};

    for (const [collectionName, documents] of Object.entries(data)) {
      if (!Array.isArray(documents) || documents.length === 0) {
        imported[collectionName] = 0;
        continue;
      }

      const collection = db.collection(collectionName);

      // Конвертируем _id строки обратно в ObjectId там где нужно
      const docs = documents.map((doc) => {
        if (doc._id && typeof doc._id === "string") {
          try {
            doc._id = new mongoose.Types.ObjectId(doc._id);
          } catch {
            // оставляем как строку если не валидный ObjectId
          }
        }
        return doc;
      });

      // insertMany с ordered: false — продолжает при дубликатах
      try {
        const result = await collection.insertMany(docs, { ordered: false });
        imported[collectionName] = result.insertedCount;
      } catch (err) {
        // E11000 — дубликаты, считаем сколько всё-таки вставилось
        imported[collectionName] = err.result?.nInserted ?? 0;
      }
    }

    return res.json({ success: true, imported });
  } catch (err) {
    console.error("importAllController error:", err);
    return res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
};
