import mongoose from "mongoose";

export default async function importCollectionController(req, res) {
  try {
    const { collectionName, mode = "replace" } = req.query;

    if (!collectionName) {
      return res.status(400).json({ message: "collectionName обязателен" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "Файл не загружен" });
    }

    const data = JSON.parse(req.file.buffer.toString());

    if (!Array.isArray(data)) {
      return res.status(400).json({ message: "JSON должен быть массивом" });
    }

    const db = mongoose.connection.getClient().db();
    const collection = db.collection(collectionName);

    if (mode === "replace") {
      await collection.deleteMany({});
    }

    if (data.length > 0) {
      await collection.insertMany(data);
    }

    res.json({
      success: true,
      collection: collectionName,
      inserted: data.length,
      mode,
    });
  } catch (err) {
    console.error("❌ importCollection error:", err);
    res.status(500).json({ message: "Ошибка импорта коллекции" });
  }
}
