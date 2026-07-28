// server/modules/diagnostics/jobs/analysis.worker.js
//
// Отдельный процесс, выполняющий разбор. Запуск: npm run worker:diagnostics
// (в проде — отдельным приложением pm2).
//
// СМЫСЛ ОТДЕЛЬНОГО ПРОЦЕССА. Перезапуск API больше не обрывает идущий разбор,
// а перезапуск воркера не теряет очередь: невыполненные задания лежат в Redis.
// Раньше деплой в момент разбора означал зависшее дело — и именно это и
// случилось в работе.
//
// ВАЖНО: воркер обязан импортировать modules/diagnostics/index.js. Модальности
// регистрируются при импорте своих файлов, и без этого getModality вернёт null
// на каждое задание — разбор «сломается» так, что причина будет неочевидна.
//
// Одно задание за раз (concurrency: 1) — сознательно. Внутри одного дела
// модальности и так идут последовательно, чтобы не ловить 429 от внешней
// модели; параллелить дела между собой на одном ключе — тот же риск, только
// незаметнее.

import "dotenv/config";
import mongoose from "mongoose";
import { Worker } from "bullmq";

import { redis } from "../../../common/config/redis.js";
import { QUEUE_NAME } from "./analysis.queue.js";

// Регистрация модальностей и анализаторов. Без этого импорта воркер запустится
// и будет валить каждое задание.
import "../index.js";

import { runPendingJobs, reapStaleJobs } from "../core/services/analysis.service.js";

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URL;
if (!MONGODB_URI) {
  console.error("❌ diagnostics worker: MONGODB_URI не задан");
  process.exit(1);
}

mongoose.set("strictQuery", true);
await mongoose.connect(MONGODB_URI, {
  dbName: process.env.MONGODB_DB || "DOCPATS_NEW",
});
console.log("✅ diagnostics worker: MongoDB подключена");

// Уборка на старте: если предыдущий воркер убили на середине задания, оно
// висит в «выполняется». Пометить сбойным здесь — единственный момент, когда
// точно известно, что выполнявший процесс мёртв.
const reaped = await reapStaleJobs({});
if (reaped) console.log(`🧹 diagnostics worker: помечено брошенных заданий — ${reaped}`);

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { caseId } = job.data;
    console.log(`🔬 diagnostics: разбор дела ${caseId}`);
    const results = await runPendingJobs(caseId);
    console.log(`✅ diagnostics: дело ${caseId} — заданий обработано ${results.length}`);
    return { jobs: results.length };
  },
  {
    connection: redis,
    concurrency: 1,
    // Задание разбора может идти минуты; сторож не должен считать его
    // потерянным раньше времени.
    lockDuration: 10 * 60 * 1000,
  },
);

worker.on("failed", (job, err) => {
  console.error(`❌ diagnostics: дело ${job?.data?.caseId} — ${err?.message}`);
});

// Корректное завершение: дать текущему заданию доработать, а не обрывать его
// ровно тем способом, от которого мы уходим.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, async () => {
    console.log(`⏹ diagnostics worker: ${signal}, завершаем текущее задание…`);
    await worker.close();
    await mongoose.disconnect();
    process.exit(0);
  });
}

console.log("🚀 diagnostics worker: очередь слушается");
