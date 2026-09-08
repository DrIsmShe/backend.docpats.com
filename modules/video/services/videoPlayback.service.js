// server/modules/video/services/videoPlayback.service.js
//
// Выдача ссылки на файл и учёт просмотра.
//
// ПОЧЕМУ ССЫЛКА ПОДПИСАННАЯ И КОРОТКАЯ. Публичный адрес файла в R2 — это
// адрес навсегда: попав в историю браузера, в мессенджер или в журнал
// прокси, он открывает ролик кому угодно и сколько угодно. Для ролика с
// пациентом это утечка медицинской записи. Поэтому наружу отдаётся ссылка,
// живущая минуты, — тем же приёмом, что и пропуск в студию.
//
// ПОЧЕМУ СРОК РАЗНЫЙ. Ролик витрины и запись приёма не одно и то же: первый
// можно кэшировать час, второму хватает десяти минут, чтобы человек нажал
// «play». Разделение по признаку PHI, а не по роли: роль меняется, природа
// записи — нет.
//
// СОБЫТИЕ ПРОСМОТРА ОТДЕЛЕНО ОТ ВЫДАЧИ ССЫЛКИ. Ссылку берёт плеер при
// открытии страницы — это ещё не просмотр. Просмотром считается доложенное
// плеером время, и именно на нём в фазе 2 будет держаться видео-согласие:
// «пациент досмотрел объяснение до конца» — утверждение, за которое отвечают
// в споре, и подтверждаться оно должно фактом, а не открытой вкладкой.

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import r2 from "../../../common/services/r2Client.js";
import Video from "../models/video.model.js";
import { canView } from "./video.service.js";
import {
  NotFoundError,
  ValidationError,
  ServiceUnavailableError,
} from "../../../common/utils/errors.js";
import { recordAction } from "../../audit/services/audit.service.js";
import { registerWatch as продвинутьСогласия } from "./videoConsent.service.js";
import { registerWatch as продвинутьПланы } from "./videoPlaylist.service.js";

/** Сколько живёт ссылка. PHI — минимум, публичное — час. */
const TTL_PHI = 10 * 60;
const TTL_ОБЫЧНЫЙ = 60 * 60;

/** Доля просмотра, начиная с которой считаем «досмотрел». */
const ПОРОГ_ДОСМОТРА = 0.9;

function bucket() {
  return process.env.R2_BUCKET || "";
}

/**
 * Главы — из сценария, а не из отдельного поля.
 *
 * У машинного ролика сцены заданы в секундах ещё до рендера: это и есть
 * готовое оглавление, его не нужно ни размечать руками, ни распознавать в
 * готовом файле. У снятых человеком роликов сценария нет — там глав не
 * будет, и это честнее пустого списка из одной главы «весь ролик».
 *
 * Подпись главы берётся из caption, а если её нет — из первых слов реплики:
 * оглавление из трёх предложений бесполезно.
 */
function главы(video) {
  const сцены = video?.generation?.script?.scenes;
  if (!Array.isArray(сцены) || сцены.length < 2) return [];

  const итог = [];
  let позиция = 0;
  for (const сцена of сцены) {
    const подпись =
      String(сцена.caption || "").trim() ||
      String(сцена.narration || "").trim().split(/(?<=[.!?])\s/)[0] ||
      "";
    if (подпись) {
      итог.push({
        startSec: Math.round(позиция),
        title: подпись.slice(0, 80),
      });
    }
    позиция += Number(сцена.seconds) || 0;
  }
  return итог;
}

/**
 * Подписать один ключ.
 *
 * Ключ приходит из нашей же записи каталога, а не из запроса, — подставить
 * чужой путь через параметр невозможно по устройству.
 */
async function подписать(key, ttl) {
  return getSignedUrl(
    r2,
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
    { expiresIn: ttl },
  );
}

/**
 * Ссылки для воспроизведения.
 *
 * Отдаём манифест HLS, если он есть, иначе исходный файл: пока студия не
 * научилась нарезать, плеер должен играть то, что есть, а не показывать
 * ошибку. Постер подписывается тем же сроком — иначе картинка отвалится
 * раньше, чем закончится ролик.
 *
 * ОГОВОРКА ПРО HLS: подписывается только манифест. Сегменты внутри него
 * подписи не несут, поэтому HLS-раздача пока годится для публичных роликов,
 * а для PHI до фазы «сегменты через свой прокси» отдаётся цельный файл.
 */
export async function getPlaybackUrls({ actor, id }) {
  const video = await Video.findById(id);
  if (!video || !canView(video, actor)) throw new NotFoundError("Видео не найдено");
  if (video.status !== "ready") throw new ValidationError("Ролик ещё не готов");
  if (!bucket()) throw new ServiceUnavailableError("Хранилище не настроено");

  const ttl = video.phi ? TTL_PHI : TTL_ОБЫЧНЫЙ;

  // Для ролика с пациентом цельный файл, даже если нарезка есть: сегменты
  // HLS сейчас раздаются без подписи, и ссылка на манифест открыла бы их
  // все. Лучше отдать один защищённый файл, чем удобную дыру.
  const основной = video.phi
    ? video.media.storageKey
    : video.media.hlsKey || video.media.storageKey;

  if (!основной) throw new ValidationError("У ролика нет файла");

  const [url, poster] = await Promise.all([
    подписать(основной, ttl),
    video.media.posterKey ? подписать(video.media.posterKey, ttl) : null,
  ]);

  // Дорожки субтитров: их столько же, сколько языков, и каждая — отдельный
  // файл. Ошибка в одной не должна лишать человека самого ролика.
  const subtitles = [];
  for (const дорожка of video.locales || []) {
    if (!дорожка.subtitleKey) continue;
    try {
      subtitles.push({
        lang: дорожка.lang,
        url: await подписать(дорожка.subtitleKey, ttl),
      });
    } catch {
      /* пропускаем именно эту дорожку */
    }
  }

  return {
    url,
    kind: основной === video.media.hlsKey ? "hls" : "file",
    poster,
    subtitles,
    chapters: главы(video),
    durationSec: video.media.durationSec,
    expiresInSec: ttl,
  };
}

/**
 * Ссылка на публичный ролик — для витрины, где зрителя мы не знаем.
 *
 * Отдельная функция, а не getPlaybackUrls с пустым актёром: там актёр
 * участвует в проверке доступа, и «актёра нет» не должно однажды стать
 * «доступ есть». Здесь условия жёсткие и записаны прямо в запросе.
 *
 * Просмотр гостя не считается: событие просмотра именное, а анонимный
 * счётчик витрины — задача аналитики, а не журнала.
 */
export async function getPublicPlaybackUrls({ id }) {
  const video = await Video.findOne({
    _id: id,
    visibility: "public",
    status: "ready",
    phi: false,
    archivedAt: null,
  });
  if (!video) throw new NotFoundError("Видео не найдено");
  if (!bucket()) throw new ServiceUnavailableError("Хранилище не настроено");

  const основной = video.media.hlsKey || video.media.storageKey;
  if (!основной) throw new ValidationError("У ролика нет файла");

  const [url, poster] = await Promise.all([
    подписать(основной, TTL_ОБЫЧНЫЙ),
    video.media.posterKey ? подписать(video.media.posterKey, TTL_ОБЫЧНЫЙ) : null,
  ]);

  const subtitles = [];
  for (const дорожка of video.locales || []) {
    if (!дорожка.subtitleKey) continue;
    try {
      subtitles.push({
        lang: дорожка.lang,
        url: await подписать(дорожка.subtitleKey, TTL_ОБЫЧНЫЙ),
      });
    } catch {
      /* пропускаем именно эту дорожку */
    }
  }

  return {
    url,
    kind: основной === video.media.hlsKey ? "hls" : "file",
    poster,
    subtitles,
    chapters: главы(video),
    durationSec: video.media.durationSec,
    expiresInSec: TTL_ОБЫЧНЫЙ,
  };
}

/**
 * Доложенный просмотр.
 *
 * Плеер сообщает, сколько секунд человек посмотрел. Считаем досмотром
 * достижение 90% длительности, а не 100%: на титрах и в конце ролика люди
 * закрывают вкладку, и требование ровно ста процентов означало бы, что
 * досмотров почти не бывает.
 *
 * Счётчики в записи — для витрины. Источник правды для аудита — журнал:
 * его нельзя изменить задним числом, а счётчик можно.
 */
export async function recordWatch({ actor, id, watchedSec }) {
  const video = await Video.findById(id);
  if (!video || !canView(video, actor)) throw new NotFoundError("Видео не найдено");

  const длительность = video.media.durationSec || 0;
  const посмотрено = Math.max(0, Math.min(Number(watchedSec) || 0, длительность || Infinity));
  const доля = длительность > 0 ? посмотрено / длительность : 0;
  const досмотрел = длительность > 0 && доля >= ПОРОГ_ДОСМОТРА;

  // ЖУРНАЛ ПЕРВЫМ, СЧЁТЧИКИ ВТОРЫМИ, И ЗАПИСЬ СИНХРОННАЯ.
  //
  // Обычные чтения пишутся fire-and-forget, чтобы не задерживать ответ. Здесь
  // нельзя: на этом событии в фазе 2 держится видео-согласие — утверждение
  // «пациент досмотрел объяснение перед вмешательством», за которое отвечают
  // в споре. Потерянная запись означает, что доказательства нет, а счётчик
  // на витрине при этом бодро вырос. Поэтому сначала журнал: не записалось —
  // просмотр не засчитан вовсе, и вызывающий об этом узнает.
  await recordAction({
    actor: {
      userId: actor.ownerId,
      email: actor.email || null,
      role: actor.role || (actor.ownerType === "employee" ? "employee" : null),
    },
    action: "video.watch",
    resourceType: "video",
    resourceId: video._id,
    metadata: {
      watchedSec: Math.round(посмотрено),
      durationSec: длительность,
      // Доля округлена до сотых: точность выше не нужна, а «сколько именно
      // секунд смотрел» уже записано рядом.
      ratio: Math.round(доля * 100) / 100,
      completed: досмотрел,
      phi: video.phi,
    },
  });

  video.stats.views += 1;
  if (досмотрел) video.stats.completions += 1;
  await video.save();

  // ПРОДВИЖЕНИЕ СОГЛАСИЙ — ПРЯМЫМ ВЫЗОВОМ, А НЕ ЧЕРЕЗ ШИНУ СОБЫТИЙ.
  //
  // Обычно кросс-модульное общение идёт через eventBus, но здесь оба конца
  // живут в одном модуле, а главное — emitSafe по устройству «выстрелил и
  // забыл»: потерянное событие означало бы, что человек ролик досмотрел, а
  // согласие так и висит неподписываемым. Такую потерю обнаружит только
  // пациент, упершийся в кнопку, которая не нажимается.
  //
  // Сбой здесь не срывает сам просмотр: он уже засчитан и записан в журнал.
  const кому = actor.ownerType === "user" ? actor.ownerId : null;
  const событие = {
    patientUserId: кому,
    videoId: video._id,
    watchedSec: посмотрено,
    ratio: доля,
    completed: досмотрел,
  };

  let согласия = null;
  try {
    согласия = await продвинутьСогласия(событие);
  } catch (err) {
    console.warn("[video] не удалось продвинуть согласия:", err?.message);
  }

  // Планы подготовки продвигаются отдельной попыткой, а не в одном try:
  // сбой согласий не должен лишать человека засчитанного шага подготовки,
  // и наоборот. Это разные обязательства перед разными людьми.
  try {
    await продвинутьПланы(событие);
  } catch (err) {
    console.warn("[video] не удалось продвинуть планы подготовки:", err?.message);
  }

  // След для подбора роликов — третьей отдельной попыткой и только по
  // открытым роликам без PHI (решает сам сервис). Подборка — удобство,
  // и её сбой не должен стоить человеку засчитанного просмотра.
  try {
    const { запомнитьПросмотр } = await import("./videoFeed.service.js");
    await запомнитьПросмотр({
      viewerId: actor.ownerType === "user" ? actor.ownerId : null,
      video,
      ratio: доля,
    });
  } catch (err) {
    console.warn("[video] не удалось запомнить просмотр:", err?.message);
  }

  return {
    views: video.stats.views,
    completed: досмотрел,
    // Сколько согласий этим просмотром стало можно подписать — интерфейсу
    // нужно знать, показывать ли кнопку подписи прямо сейчас.
    consentsReady: согласия?.completed || 0,
  };
}

export default { getPlaybackUrls, getPublicPlaybackUrls, recordWatch };
