import mongoose from "mongoose";

export default async function connectDB() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URL;
  const isProd = process.env.NODE_ENV === "production";

  if (!uri) {
    console.error(
      "❌ Переменные окружения MONGODB_URI/MONGO_URL отсутствуют в .env"
    );
    process.exit(1);
  }

  // ====== Глобальные настройки до подключения ======
  mongoose.set("strictQuery", true);
  mongoose.set("bufferCommands", false);

  // ====== Логи подключения ======
  mongoose.connection.on("connected", () => {
    console.log(
      `✅ MongoDB подключено: ${mongoose.connection.host}/${mongoose.connection.name}`
    );
  });

  mongoose.connection.on("error", (err) => {
    console.error("❌ Ошибка MongoDB:", err?.message || err);
  });

  mongoose.connection.on("disconnected", () => {
    console.warn("⚠️ Соединение с MongoDB разорвано");
  });

  // ====== Лог запросов только в dev ======
  if (!isProd) {
    mongoose.set("debug", (coll, method, query, doc, options) => {
      try {
        const q = JSON.stringify(query);
        const d = JSON.stringify(doc);
        const o = options ? JSON.stringify(options) : "";
        console.log(`[Mongoose] ${coll}.${method} ${q} ${d} ${o}`);
      } catch {
        console.log(`[Mongoose] ${coll}.${method}`, query, doc, options);
      }
    });
  }

  // ====== Опции подключения ======
  const connectOpts = {
    retryWrites: true, // ✅ разрешено для Atlas
    w: "majority",
    dbName: process.env.MONGODB_DB || "DOCPATS_NEW",
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 10000,
    heartbeatFrequencyMS: 8000,
    autoIndex: !isProd,
    maxPoolSize: 20,
    minPoolSize: 2,
    appName: "docpats-app",
  };

  // ====== Подключение ======
  await mongoose.connect(uri, connectOpts);

  // ====== Проверка доступности ======
  await mongoose.connection.db.admin().command({ ping: 1 });
  console.log("🟢 MongoDB ping OK");

  // ====== Грациозное завершение ======
  const gracefulExit = async (signal) => {
    try {
      console.log(`\n${signal} → закрываю MongoDB соединение...`);
      await mongoose.connection.close();
      console.log("👋 Соединение MongoDB закрыто");
      process.exit(0);
    } catch (err) {
      console.error("❌ Ошибка при закрытии MongoDB:", err?.message || err);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => gracefulExit("SIGINT"));
  process.on("SIGTERM", () => gracefulExit("SIGTERM"));

  return mongoose.connection;
}
