// server/modules/video/render/render.queue.js
//
// Очередь заданий на рендер ролика.
//
// ПОЧЕМУ У ЭТОЙ ОЧЕРЕДИ ЕСТЬ ПРЕФИКС, А У СОСЕДНИХ НЕТ. Redis один на все
// окружения проекта, и очередь без префикса — общая: воркер на машине
// разработчика забирает боевые задания. Для перевода это неприятно, для
// рендера — деньги: задание уходит в студию, тратит её ресурсы и
// возвращается вебхуком в чужую базу, где записи каталога попросту нет.
//
// Префикс берётся из окружения (VIDEO_QUEUE_PREFIX), иначе — из NODE_ENV.
// Совпадение префиксов у двух окружений — не ошибка настройки, а поломка
// по умолчанию, поэтому запуск воркера в неочевидной конфигурации громко
// сообщает о себе в логе, а не молчит.
//
// ОТКЛЮЧЕНО ПО УМОЛЧАНИЮ. Без VIDEO_RENDER=on очередь не создаётся вовсе:
// генерация роликов стоит денег, и включать её должен человек, а не факт
// выкладки кода.

import { Queue } from "bullmq";
import logger from "../../../common/logger.js";

// REDIS ИМПОРТИРУЕТСЯ ЛЕНИВО, ВНУТРИ ФУНКЦИЙ.
//
// Статический импорт открывал бы подключение при одной только загрузке
// модуля — а его тянет за собой весь модуль видео, вплоть до модели. В
// тестах это означало незакрытые сокеты и висящий процесс, в окружении без
// Redis — падение на ровном месте у того, кто генерацией не пользуется.
async function подключение() {
  const { redis } = await import("../../../common/config/redis.js");
  return redis;
}

const log = logger.child({ module: "video/render" });

export const RENDER_QUEUE_NAME = "video-render";

/** Включена ли генерация роликов. */
export function renderEnabled() {
  return String(process.env.VIDEO_RENDER || "").toLowerCase() === "on";
}

/**
 * Префикс очереди — граница между окружениями.
 *
 * Явный VIDEO_QUEUE_PREFIX старше NODE_ENV: на одной машине может работать
 * несколько веток, и «development» у них общий.
 */
export function queuePrefix() {
  const явный = String(process.env.VIDEO_QUEUE_PREFIX || "").trim();
  if (явный) return `dp:${явный}`;
  const env = String(process.env.NODE_ENV || "development").trim();
  return `dp:${env}`;
}

let очередь = null;

/**
 * Очередь. Создаётся лениво и только при включённой генерации: иначе
 * подключение к Redis открывалось бы в каждом окружении ради функции,
 * которой там не пользуются.
 */
export async function renderQueue() {
  if (!renderEnabled()) return null;
  if (очередь) return очередь;

  очередь = new Queue(RENDER_QUEUE_NAME, {
    connection: await подключение(),
    prefix: queuePrefix(),
    defaultJobOptions: {
      // Рендер — дорогая операция, повтор вслепую удваивает счёт. Две
      // попытки с большой паузой: первая на случай сетевого сбоя, вторая
      // — на случай короткой недоступности студии.
      attempts: 2,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { age: 7 * 24 * 3600, count: 500 },
      removeOnFail: { age: 30 * 24 * 3600 },
    },
  });

  log.info(
    { prefix: queuePrefix(), queue: RENDER_QUEUE_NAME },
    "очередь рендера видео поднята",
  );
  return очередь;
}

/**
 * Поставить задание на рендер.
 *
 * Идентификатор задания = идентификатор записи каталога: повторный вызов
 * для того же ролика не создаёт второго задания, сколько бы раз кнопку ни
 * нажали. Это дешевле любой проверки на стороне интерфейса.
 */
export async function enqueueRender({ videoId, script, meta = {} }) {
  const q = await renderQueue();
  if (!q) {
    throw new Error("Генерация роликов выключена (VIDEO_RENDER)");
  }
  return q.add(
    "render",
    { videoId: String(videoId), script, meta },
    { jobId: `render:${videoId}` },
  );
}

export default { renderQueue, enqueueRender, renderEnabled, queuePrefix, RENDER_QUEUE_NAME };
