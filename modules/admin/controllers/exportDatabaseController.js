import mongoose from "mongoose";

export default async function exportDatabaseController(req, res) {
  try {
    const db = mongoose.connection.getClient().db();

    const collections = await db.listCollections().toArray();

    const result = {};

    for (const col of collections) {
      const name = col.name;

      // ❌ пропускаем служебные
      if (name.startsWith("system.") || name === "sessions") continue;

      const data = await db.collection(name).find({}).toArray();

      result[name] = data;
    }

    res.setHeader("Content-Disposition", "attachment; filename=database.json");
    res.setHeader("Content-Type", "application/json");

    res.status(200).send(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("❌ exportDatabase error:", err);
    res.status(500).json({ message: "Ошибка экспорта базы" });
  }
}
