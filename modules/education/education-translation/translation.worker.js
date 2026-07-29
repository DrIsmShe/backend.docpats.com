// server/modules/education/education-translation/translation.worker.js
//
// Воркер очереди перевода вопросов.
//
// Запускается вместе с API (импортом из index.js) либо отдельным процессом:
//   node modules/education/education-translation/translation.worker.js
//
// Отдельный процесс имеет смысл, когда переводов много: вызовы модели долгие,
// и держать их в процессе API значит занимать его event loop ожиданием сети.
//
// concurrency: 2 — не больше. Перевод идёт в модель, и десяток параллельных
// заданий упрётся в лимит запросов провайдера, а не ускорит работу.

import logger from "../../../common/logger.js";
import { QUEUE_NAME } from "./translation.queue.js";

let worker = null;

export async function startTranslationWorker() {
  if (worker) return worker;
  // Общий клиент проекта — тот же, что у остальных воркеров. Он подставляет
  // 127.0.0.1:6379, когда REDIS_HOST не задан, а именно так и настроен
  // боевой сервер.
  const [{ Worker }, { redis }, { translateItem }] = await Promise.all([
    import("bullmq"),
    import("../../../common/config/redis.js"),
    import("./translateItem.service.js"),
  ]);

  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { itemId, actorId, force } = job.data;
      return translateItem(itemId, { actorId, force });
    },
    { connection: redis, concurrency: 2 },
  );

  worker.on("failed", (job, err) => {
    logger?.error?.(
      { err, itemId: job?.data?.itemId, attempt: job?.attemptsMade },
      "education translation job failed",
    );
  });

  logger?.info?.("education translation worker запущен");
  return worker;
}

// Запуск отдельным процессом.
if (process.argv[1]?.endsWith("translation.worker.js")) {
  const mongoose = (await import("mongoose")).default;
  await mongoose.connect(process.env.MONGO_URL);
  await startTranslationWorker();
}
