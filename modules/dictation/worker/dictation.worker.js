// server/modules/dictation/worker/dictation.worker.js
//
// Обработка надиктовок ОТДЕЛЬНЫМ процессом.
//
// По умолчанию этот файл не нужен: те же циклы крутятся внутри API-процесса
// (см. worker/runner.js и вызов в index.js) — так модуль работает сразу после
// деплоя, без отдельного PM2-процесса, который легко забыть поднять.
//
// Отдельный процесс нужен, когда надиктовок станет много: распознавание
// полутора минут речи плюс вызов модели — это десятки секунд, и держать их в
// одном процессе с API в какой-то момент станет заметно. Тогда:
//
//   DICTATION_INLINE_WORKER=false   в .env API-процесса
//   pm2 start npm --name dictation -- run worker:dictation
//
// Оба режима одновременно тоже безопасны — захват задания атомарный.

import "dotenv/config";
import mongoose from "mongoose";
import { startDictationWorker, DICTATION_WORKER_INTERVALS } from "./runner.js";

async function connect() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URL;
  if (!uri) {
    console.error("❌ dictation-worker: MONGODB_URI не задан");
    process.exit(1);
  }
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB || "DOCPATS_NEW" });
  console.log("✅ dictation-worker: MongoDB подключена");
}

await connect();

const stop = startDictationWorker({ log: (msg) => console.log(`🧾 ${msg}`) });
console.log(
  `▶️  dictation-worker: опрос каждые ${DICTATION_WORKER_INTERVALS.POLL_MS} мс`,
);

function shutdown(signal) {
  console.log(`⏹️  dictation-worker: ${signal}, завершаюсь`);
  stop();
  // Даём текущему шагу договорить, затем выходим. Если шаг не успеет —
  // задание останется в промежуточном статусе, и его подберёт цикл возврата
  // зависших после рестарта.
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
