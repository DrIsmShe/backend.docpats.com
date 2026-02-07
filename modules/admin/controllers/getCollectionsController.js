import mongoose from "mongoose";

export default function getCollectionsController(req, res) {
  try {
    // ✅ Берём ТОЛЬКО зарегистрированные Mongoose-модели
    const modelNames = Object.keys(mongoose.models)
      .filter(
        (name) => !["Session"].includes(name), // при желании скрываем служебные
      )
      .sort();

    res.json({ collections: modelNames });
  } catch (err) {
    console.error("❌ getCollections error:", err);
    res.status(500).json({
      message: "Ошибка получения моделей",
      error: err.message,
    });
  }
}
