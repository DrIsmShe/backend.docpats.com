// jobs/r2OrphanCleanup.cron.js
//
// Cron-воркер для очистки осиротевших R2 файлов.
// Читает OrphanR2File с succeeded=false, attempts<maxAttempts,
// удаляет файл из R2 через uploadMiddleware.deleteFile (тот же
// клиент r2Client.js, та же логика URL→key), помечает результат.
//
// Schedule: каждые 15 минут (через node-cron).
// Batch size: 100 записей за тик.
// Если attempt fail — увеличиваем attempts, пишем lastError.
// Когда attempts >= maxAttempts — succeeded остаётся false, новые тики
// эту запись игнорируют (фильтр attempts < maxAttempts). Видно в логах
// как warning — оператор может либо вручную почистить (R2 dashboard),
// либо сбросить attempts=0 для повторной попытки.
//
// Запуск из index.js bootstrap() через startR2OrphanCleanupCron().

import cron from "node-cron";
import OrphanR2File from "../common/models/system/OrphanR2File.js";
import { deleteFile } from "../common/middlewares/uploadMiddleware.js";
import { recordActionAsync } from "../modules/audit/services/audit.service.js";
import logger from "../common/logger.js";

const log = logger.child({ module: "jobs/r2-orphan-cleanup" });

const BATCH_SIZE = 100;
const SCHEDULE = "*/15 * * * *"; // каждые 15 минут
const AUDIT_ACTOR = {
  // System-level действия. audit.service ожидает actor.userId,
  // используем фиксированный sentinel чтобы не путаться с реальными User.
  // В hipaa_audit_logs.userId будет null + actorRole "system".
  userId: null, // см. ниже — мы НЕ зовём audit с null userId, обернём
  role: "system",
};

/**
 * Один прогон очистки. Можно вызвать вручную для тестов или
 * операционного триггера (например, ручная команда после массового
 * удаления).
 *
 * @returns {Promise<{processed: number, succeeded: number, failed: number, exhausted: number}>}
 */
export async function runR2OrphanCleanupOnce() {
  const startedAt = Date.now();

  // Берём только записи которые ещё можно повторить
  const candidates = await OrphanR2File.find({
    succeeded: false,
    $expr: { $lt: ["$attempts", "$maxAttempts"] },
  })
    .sort({ deletedAt: 1 })
    .limit(BATCH_SIZE)
    .lean();

  if (candidates.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, exhausted: 0 };
  }

  let succeeded = 0;
  let failed = 0;
  let exhausted = 0;

  for (const orphan of candidates) {
    const nextAttempts = orphan.attempts + 1;
    const now = new Date();

    try {
      // deleteFile использует ту же URL→key логику что и uploadMiddleware
      // (split по R2_PUBLIC_URL). Идемпотентна — если файла уже нет в R2,
      // S3 DeleteObjectCommand вернёт 204 без ошибки.
      await deleteFile(orphan.fileUrl);

      await OrphanR2File.updateOne(
        { _id: orphan._id },
        {
          $set: {
            succeeded: true,
            attempts: nextAttempts,
            lastAttemptedAt: now,
            completedAt: now,
            lastError: null,
          },
        },
      );
      succeeded += 1;
    } catch (err) {
      const errorMessage = String(err?.message || err).slice(0, 500);
      await OrphanR2File.updateOne(
        { _id: orphan._id },
        {
          $set: {
            attempts: nextAttempts,
            lastAttemptedAt: now,
            lastError: errorMessage,
          },
        },
      );

      if (nextAttempts >= (orphan.maxAttempts || 5)) {
        exhausted += 1;
        log.error(
          {
            orphanId: String(orphan._id),
            fileUrl: orphan.fileUrl,
            sourceModel: orphan.sourceModel,
            sourceId: orphan.sourceId ? String(orphan.sourceId) : null,
            attempts: nextAttempts,
            lastError: errorMessage,
          },
          "R2 orphan exhausted retries — manual cleanup required",
        );
      } else {
        failed += 1;
        log.warn(
          {
            orphanId: String(orphan._id),
            attempt: nextAttempts,
            lastError: errorMessage,
          },
          "R2 orphan cleanup attempt failed, will retry next tick",
        );
      }
    }
  }

  const durationMs = Date.now() - startedAt;
  log.info(
    {
      processed: candidates.length,
      succeeded,
      failed,
      exhausted,
      durationMs,
    },
    "R2 orphan cleanup tick completed",
  );

  // System-level audit (один на тик, агрегированно). audit.service
  // требует actor.userId, поэтому пропускаем если в этом тике делать
  // нечего значимое. Для exhausted - всегда фиксируем.
  if (succeeded > 0 || exhausted > 0) {
    try {
      recordActionAsync({
        actor: {
          userId: "system",
          email: null,
          role: "system",
        },
        action: "system.r2_orphan.cleanup",
        resourceType: "orphan-r2-file",
        // resourceId не указываем — это batch action; audit.service
        // разрешает null для actions с суффиксами .list/.search/.user_search,
        // но не для произвольных. Если будет warning — добавим
        // "system.r2_orphan.cleanup" в isCollectionAction whitelist
        // в audit.service.js. Пока — ловим warning в логах, не критично.
        outcome: exhausted > 0 ? "failure" : "success",
        metadata: {
          processed: candidates.length,
          succeeded,
          failed,
          exhausted,
          durationMs,
        },
        context: {
          httpMethod: null,
          httpPath: null,
          statusCode: null,
        },
      });
    } catch {
      // audit fire-and-forget, не падаем
    }
  }

  return {
    processed: candidates.length,
    succeeded,
    failed,
    exhausted,
  };
}

/**
 * Стартует cron. Вызывается из index.js bootstrap.
 * Возвращает task object — можно остановить через task.stop() для graceful
 * shutdown или тестов.
 */
export function startR2OrphanCleanupCron() {
  log.info(
    { schedule: SCHEDULE, batchSize: BATCH_SIZE },
    "R2 orphan cleanup cron starting",
  );

  const task = cron.schedule(
    SCHEDULE,
    async () => {
      try {
        await runR2OrphanCleanupOnce();
      } catch (err) {
        log.error({ err }, "R2 orphan cleanup tick crashed");
      }
    },
    { scheduled: true },
  );

  return task;
}

export default {
  runR2OrphanCleanupOnce,
  startR2OrphanCleanupCron,
};
