// server/modules/diagnostics/jobs/analysis.queue.js
//
// Очередь разбора. Отделяет ПОСТАНОВКУ задания от его ВЫПОЛНЕНИЯ.
//
// ЗАЧЕМ. До сих пор разбор выполнялся в том же процессе, что и API:
// контроллер вызывал runPendingJobs без await. Из-за этого любой перезапуск
// процесса — деплой, pm2 restart, падение — обрывал разбор на середине, и
// задание навсегда зависало в статусе «выполняется». Уборка брошенных заданий,
// сделанная раньше, лечит симптом: врач хотя бы видит, что разбор оборвался, и
// может запустить заново. Причина уходит только здесь.
//
// С очередью перезапуск API не трогает идущий разбор, а перезапуск воркера не
// теряет очередь: невыполненные задания лежат в Redis и подхватываются после
// старта.
//
// ЗАПАСНОЙ ПУТЬ ОБЯЗАТЕЛЕН. Если Redis недоступен, модуль НЕ должен переставать
// работать: разбор выполняется в процессе, как раньше. Это хуже (перезапуск
// снова рвёт), но несравнимо лучше отказа в работе врачу. Поэтому здесь
// try/catch вокруг постановки, а не «упало — значит упало».

import logger from "../../../common/logger.js";

// bullmq и клиент Redis подключаются ЛЕНИВО, внутри getQueue().
//
// Иначе один только импорт модуля открывал бы соединение с Redis — а модуль
// импортируется отовсюду, включая тесты и окружения, где Redis не поднят.
// Висящее соединение там не просто лишнее: ioredis переподключается
// бесконечно и не даёт процессу завершиться.

export const QUEUE_NAME = "diagnostics-analysis";

// Выключатель: DIAGNOSTICS_QUEUE=off возвращает прежнее поведение целиком.
// Нужен на случай, если очередь поведёт себя неожиданно в проде, — откатывать
// деплой ради этого не придётся.
const ENABLED = process.env.DIAGNOSTICS_QUEUE !== "off";

let queue = null;

/** Очередь создаётся при первом обращении: без неё процесс не должен падать. */
async function getQueue() {
  if (!ENABLED) return null;
  if (queue) return queue;
  try {
    const [{ Queue }, { redis }] = await Promise.all([
      import("bullmq"),
      import("../../../common/config/redis.js"),
    ]);
    queue = new Queue(QUEUE_NAME, {
      connection: redis,
      defaultJobOptions: {
        // Повтор с задержкой: типичный сбой здесь — таймаут внешней модели или
        // 429, и оба лечатся паузой. Три попытки, дальше задание помечается
        // сбойным в базе и врач видит кнопку «Попробовать ещё раз».
        attempts: 3,
        backoff: { type: "exponential", delay: 30000 },
        removeOnComplete: { age: 24 * 3600, count: 500 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
    return queue;
  } catch (err) {
    logger?.warn?.({ err }, "diagnostics: очередь недоступна, разбор пойдёт в процессе API");
    return null;
  }
}

/**
 * Поставить дело в очередь на разбор.
 *
 * @returns {Promise<boolean>} true — принято очередью; false — вызывающий код
 *   должен выполнить разбор сам (запасной путь).
 */
export async function enqueueAnalysis(caseId) {
  const q = await getQueue();
  if (!q) return false;
  try {
    await q.add(
      "analyze",
      { caseId: String(caseId) },
      // jobId по делу: повторное нажатие «Разобрать» не плодит дубли в
      // очереди, пока предыдущее задание не завершилось.
      { jobId: `case:${caseId}` },
    );
    return true;
  } catch (err) {
    logger?.warn?.({ err, caseId: String(caseId) }, "diagnostics: не удалось поставить в очередь");
    return false;
  }
}

export function isQueueEnabled() {
  return ENABLED;
}

/** Только для тестов и корректного завершения процесса. */
export async function closeQueue() {
  if (queue) {
    await queue.close();
    queue = null;
  }
}
