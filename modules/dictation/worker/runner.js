// server/modules/dictation/worker/runner.js
//
// Сами циклы обработки. Вынесены из dictation.worker.js, потому что запускать
// их нужно из двух мест:
//
//   * из index.js — внутри API-процесса, как у соседних воркеров. Так модуль
//     работает сразу после деплоя. Очередь без потребителя — худший из отказов:
//     врач жмёт «записать», аудио уходит, ошибки нет, черновик не появляется
//     никогда, и узнаём мы об этом от врача, а не от мониторинга.
//   * из dictation.worker.js — отдельным процессом, когда надиктовок станет
//     много и распознавание начнёт мешать API. Тогда достаточно поднять
//     PM2-процесс и выставить DICTATION_INLINE_WORKER=false.
//
// Захват задания атомарный (findOneAndUpdate в processNext), поэтому оба
// режима одновременно безопасны: два потребителя не возьмут одну стадию.

import { processNext, runRetention, reclaimStale } from "../dictation.service.js";
import logger from "../../../common/logger.js";

/** Пауза между опросами пустой очереди. */
const POLL_MS = Number(process.env.DICTATION_POLL_MS ?? 5000);
// Уборка аудио — раз в час: чаще незачем, реже значит держать голос дольше
// необходимого.
const RETENTION_MS = Number(process.env.DICTATION_RETENTION_MS ?? 3600000);
// Возврат зависших — раз в пять минут. Это не уборка, а восстановление после
// падения: врач ждёт черновик, и час простоя тут заметен.
const RECLAIM_MS = Number(process.env.DICTATION_RECLAIM_MS ?? 300000);
const STALE_MS = Number(process.env.DICTATION_STALE_MS ?? 600000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Запускает обработку. Возвращает функцию остановки.
 *
 * @param {object} [opts]
 * @param {(msg: string) => void} [opts.log] куда писать заметные события
 * @returns {() => void}
 */
export function startDictationWorker({ log } = {}) {
  const say = log ?? ((msg) => logger?.info?.(msg));
  let stopping = false;

  async function queueLoop() {
    while (!stopping) {
      try {
        // Пока очередь не пуста — работаем без пауз: задания приходят пачками
        // (врач надиктовал приём за приёмом), и ждать между ними незачем.
        const out = await processNext();
        if (!out.picked) await sleep(POLL_MS);
      } catch (err) {
        // Цикл не должен умирать от одиночной ошибки: упавший потребитель
        // означает застрявшие надиктовки, о которых никто не узнает до жалобы.
        logger?.error?.(
          { err: err?.message ?? err },
          "dictation: ошибка обработки задания",
        );
        await sleep(POLL_MS);
      }
    }
  }

  async function retentionLoop() {
    while (!stopping) {
      try {
        const out = await runRetention();
        if (out.purged || out.expired) {
          say(
            `dictation: аудио удалено ${out.purged}, просрочено заданий ${out.expired}`,
          );
        }
      } catch (err) {
        logger?.error?.({ err: err?.message ?? err }, "dictation: ретеншн не прошёл");
      }
      await sleep(RETENTION_MS);
    }
  }

  async function reclaimLoop() {
    while (!stopping) {
      await sleep(RECLAIM_MS);
      try {
        const { reclaimed } = await reclaimStale({ olderThanMs: STALE_MS });
        if (reclaimed) say(`dictation: возвращено в очередь заданий: ${reclaimed}`);
      } catch (err) {
        logger?.error?.(
          { err: err?.message ?? err },
          "dictation: возврат зависших не прошёл",
        );
      }
    }
  }

  // Циклы не ждём: функция должна вернуть управление вызвавшему.
  Promise.all([queueLoop(), retentionLoop(), reclaimLoop()]).catch((err) => {
    logger?.error?.({ err: err?.message ?? err }, "dictation: воркер остановился");
  });

  return () => {
    stopping = true;
  };
}

export const DICTATION_WORKER_INTERVALS = {
  POLL_MS,
  RETENTION_MS,
  RECLAIM_MS,
  STALE_MS,
};
