// server/modules/video/render/render.worker.js
//
// Воркер рендера: отдаёт сценарий студии и ждёт, когда та вернёт файл.
//
// ГДЕ ЗДЕСЬ ГРАНИЦА. Рендер делает студия DP-Videra — служба на другом
// сервере. Наша часть: поставить задание, дождаться подтверждения приёма и
// перевести запись каталога в "processing". Готовый файл приходит потом
// вебхуком /api/v1/video/studio/callback — он уже написан и идемпотентен.
//
// ПОЧЕМУ НЕ ЖДЁМ РЕНДЕР В ЗАДАНИИ. Ролик рендерится минутами, иногда
// десятками минут. Держать соединение всё это время — значит завязать
// результат на живучесть двух процессов и таймауты между ними. Студия и так
// умеет докладывать сама; задание считается выполненным, когда она приняла
// работу.
//
// ЗАПУСК. Воркер стартует ТОЛЬКО при VIDEO_RENDER=on и, в отличие от
// соседних воркеров, печатает свой префикс очереди в лог: на общем Redis
// это единственный способ заметить, что окружения перепутаны, до того как
// они начнут воровать друг у друга задания.

import { Worker } from "bullmq";
import logger from "../../../common/logger.js";
import Video from "../models/video.model.js";
import { RENDER_QUEUE_NAME, renderEnabled, queuePrefix } from "./render.queue.js";
import { заголовкиВызова } from "../studioCallback.js";
import { студия, студияВключена } from "../../videra/pass.js";

const log = logger.child({ module: "video/render-worker" });

/** Сколько ждём ответа студии на постановку задания. */
const ТАЙМАУТ_МС = 30_000;

/**
 * Отправить сценарий студии.
 *
 * Подписываем тем же способом, что и вебхук в обратную сторону: у сторон
 * один общий ключ, и вторая подпись ничего не добавила бы.
 */
async function отправитьВСтудию({ videoId, script, meta }) {
  const url = `${студия()}/api/render`;
  const тело = { studioFilmId: String(videoId), script, meta };

  const ответ = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...заголовкиВызова({ studioFilmId: String(videoId), status: "queued" }),
    },
    body: JSON.stringify(тело),
    signal: AbortSignal.timeout(ТАЙМАУТ_МС),
  });

  if (!ответ.ok) {
    const текст = await ответ.text().catch(() => "");
    throw new Error(`студия отказала: ${ответ.status} ${текст.slice(0, 200)}`);
  }
  return ответ.json().catch(() => ({}));
}

export async function обработатьЗадание(job) {
  const { videoId, script, meta } = job.data;

  const video = await Video.findById(videoId);
  if (!video) {
    // Запись удалили, пока задание ждало очереди. Это не ошибка: рендерить
    // нечего и некуда возвращать результат.
    log.warn({ videoId }, "запись каталога исчезла — задание отброшено");
    return { skipped: true };
  }

  if (!студияВключена()) {
    throw new Error("не задан DPVIDERA_SECRET — студии нечем подписаться");
  }

  video.status = "processing";
  video.source.studioFilmId = String(video._id);
  await video.save();

  try {
    const итог = await отправитьВСтудию({ videoId, script, meta });
    log.info({ videoId, scenes: script?.scenes?.length }, "сценарий принят студией");
    return { accepted: true, ...итог };
  } catch (err) {
    // Состояние обязано отражать правду: не «рендерится», а «не вышло».
    // Иначе ролик навсегда останется с крутящимся индикатором, и никто не
    // поймёт, что задание вообще не дошло.
    video.status = "failed";
    video.failureReason = String(err?.message || "").slice(0, 500);
    await video.save();
    throw err;
  }
}

let воркер = null;

/** Поднять воркер. Зовётся из index.js при старте процесса. */
export async function startRenderWorker() {
  if (!renderEnabled()) {
    log.info("генерация роликов выключена (VIDEO_RENDER)");
    return null;
  }
  if (воркер) return воркер;

  // Ленивый импорт — по той же причине, что и в очереди: подключение к
  // Redis не должно открываться там, где генерация выключена.
  const { redis } = await import("../../../common/config/redis.js");

  воркер = new Worker(RENDER_QUEUE_NAME, обработатьЗадание, {
    connection: redis,
    prefix: queuePrefix(),
    // Один за раз. Рендер тяжёлый, и параллельные задания в студии не
    // ускоряют её, а выстраиваются в ту же очередь — только уже внутри неё,
    // где мы их не видим и не можем отменить.
    concurrency: 1,
  });

  воркер.on("failed", (job, err) => {
    log.error({ jobId: job?.id, err: err?.message }, "задание рендера не выполнено");
  });

  log.info({ prefix: queuePrefix() }, "воркер рендера видео запущен");
  return воркер;
}

export default { startRenderWorker, обработатьЗадание };
