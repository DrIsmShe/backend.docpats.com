// server/modules/education/education-translation/translation.queue.js
//
// Очередь перевода вопросов. Отделяет публикацию от перевода.
//
// ЗАЧЕМ ОЧЕРЕДЬ. Перевод одного вопроса на четыре языка — это четыре вызова
// модели, порядка полуминуты. Делать их внутри запроса «опубликовать» значит
// заставить рецензента ждать полминуты на каждой кнопке и потерять перевод при
// любом обрыве соединения. Публикация обязана оставаться мгновенной: она и
// сама по себе полезна, перевод её только дополняет.
//
// ЗАПАСНОЙ ПУТЬ ОБЯЗАТЕЛЕН. Если Redis недоступен, модуль не должен переставать
// работать: перевод выполняется в этом же процессе, без await. Это хуже —
// перезапуск рвёт незаконченное, — но несравнимо лучше, чем не переводить
// вовсе или уронить публикацию.
//
// bullmq и Redis подключаются ЛЕНИВО, внутри getQueue(): иначе один импорт
// модуля открывал бы соединение везде, включая тесты, где Redis не поднят, а
// ioredis переподключается бесконечно и не даёт процессу завершиться.

import logger from "../../../common/logger.js";

export const QUEUE_NAME = "education-translation";

let queuePromise = null;

async function getQueue() {
  if (queuePromise) return queuePromise;

  queuePromise = (async () => {
    if (!process.env.REDIS_URL && !process.env.REDIS_HOST) return null;
    const { Queue } = await import("bullmq");
    const IORedis = (await import("ioredis")).default;
    const connection = new IORedis(
      process.env.REDIS_URL ?? {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT ?? 6379),
      },
      { maxRetriesPerRequest: null },
    );
    return new Queue(QUEUE_NAME, { connection });
  })().catch((err) => {
    logger?.warn?.({ err }, "education translation queue unavailable");
    return null;
  });

  return queuePromise;
}

/**
 * Ставит перевод вопроса в очередь. Никогда не бросает: перевод — улучшение
 * поверх публикации, и его срыв не должен отменять публикацию вопроса.
 *
 * jobId детерминирован (item:<id>:v<version>) — повторная постановка того же
 * задания при двойном нажатии или ретрае не создаёт второе.
 */
export async function enqueueItemTranslation({ itemId, version, actorId = null, force = false }) {
  const id = String(itemId);
  try {
    const queue = await getQueue();
    if (queue) {
      await queue.add(
        "translate-item",
        { itemId: id, actorId, force },
        {
          jobId: `item:${id}:v${version}${force ? ":force" : ""}`,
          removeOnComplete: true,
          removeOnFail: 50,
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
        },
      );
      return { queued: true };
    }
  } catch (err) {
    logger?.warn?.({ err, itemId: id }, "failed to enqueue translation, running inline");
  }

  // Запасной путь: в этом же процессе, но без await — публикация не ждёт.
  runInline({ itemId: id, actorId, force });
  return { queued: false, inline: true };
}

function runInline({ itemId, actorId, force }) {
  setImmediate(async () => {
    try {
      const { translateItem } = await import("./translateItem.service.js");
      await translateItem(itemId, { actorId, force });
    } catch (err) {
      logger?.error?.({ err, itemId }, "inline exam item translation failed");
    }
  });
}
