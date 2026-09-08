// server/modules/video/services/videoFeed.service.js
//
// Подбор роликов «по интересам» для главной страницы витрины.
//
// КАК ЭТО УСТРОЕНО И ПОЧЕМУ ТАК ПРОСТО. Интерес зрителя описывается тремя
// вещами, которые он показал сам: какие разделы он досматривает, каких
// авторов смотрит и на кого подписан. Из них складывается вес кандидата.
// Никакой «модели поведения» здесь нет и не нужно: на медицинской витрине
// с сотнями роликов честная эвристика работает не хуже, а объяснить её
// можно за минуту — что важно, когда спросят, почему человеку показали
// именно этот разбор.
//
// ЧЕГО ЗДЕСЬ НЕТ СОЗНАТЕЛЬНО. Подборка не смотрит ни на диагнозы, ни на
// приёмы, ни на приватные ролики — только на след в открытой витрине
// (см. videoInterest.model.js). Рекомендовать человеку ролики, исходя из
// его медицинской карты, — это ровно то, за что такие системы и получают
// по рукам: витрина открыта, а рядом с человеком бывают другие люди.
//
// ХОЛОДНЫЙ СТАРТ. У нового зрителя следа нет, и притворяться, что он есть,
// незачем: показываем свежее и то, что смотрят другие. Это же видит гость.

import mongoose from "mongoose";
import Video from "../models/video.model.js";
import VideoInterest from "../models/videoInterest.model.js";
import VideoSubscription from "../models/videoSubscription.model.js";

/** Сколько последних просмотров формируют портрет интересов. */
const ГЛУБИНА_ИСТОРИИ = 60;

/** Насколько досмотренный ролик считается интересом, а не промахом. */
const ПОРОГ_ИНТЕРЕСА = 0.15;

/* Веса. Числа подобраны так, чтобы ни один признак не решал в одиночку:
   раздел задаёт тему, канал — доверие к автору, подписка — прямо
   высказанное желание. Свежесть добавляется отдельно, иначе лента
   застынет на однажды удачных роликах. */
const ВЕС_РАЗДЕЛА = 3;
const ВЕС_КАНАЛА = 2;
const ВЕС_ПОДПИСКИ = 6;
const ВЕС_ЯЗЫКА = 2;
const ВЕС_ПОПУЛЯРНОСТИ = 1.5;
const ВЕС_СВЕЖЕСТИ = 2;

/**
 * Запомнить просмотр — для подбора, и только по открытому ролику.
 *
 * Вызывается из recordWatch. Сбой здесь не должен ломать просмотр: подборка
 * — это удобство, а просмотр — обязательство, поэтому вызывающий оборачивает
 * вызов в свой try.
 */
export async function запомнитьПросмотр({ viewerId, video, ratio }) {
  // Личное — мимо: см. большой комментарий в videoInterest.model.js.
  if (!viewerId) return null;
  if (video.phi) return null;
  if (video.visibility !== "public") return null;

  const канал = video.clinicId
    ? { channelType: "clinic", channelId: video.clinicId }
    : { channelType: "user", channelId: video.ownerId };

  return VideoInterest.findOneAndUpdate(
    { viewerId, videoId: video._id },
    {
      $set: {
        categoryId: video.categoryId || null,
        kind: video.kind || "",
        lang: video.lang || "",
        ...канал,
        // Берём лучший результат, а не последний: человек, пересмотревший
        // начало, ролик от этого менее интересным не сделал.
        ratio: Math.max(0, Math.min(1, Number(ratio) || 0)),
        watchedAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).catch((e) => {
    // Гонка двух вкладок на upsert — не повод шуметь.
    if (e?.code === 11000) return null;
    throw e;
  });
}

/** Портрет интересов: веса разделов, каналов и языков. */
async function портрет(viewerId) {
  const [история, подписки] = await Promise.all([
    VideoInterest.find({ viewerId, ratio: { $gte: ПОРОГ_ИНТЕРЕСА } })
      .sort({ watchedAt: -1 })
      .limit(ГЛУБИНА_ИСТОРИИ)
      .lean(),
    VideoSubscription.find({ subscriberId: viewerId }).lean(),
  ]);

  const разделы = new Map();
  const каналы = new Map();
  const языки = new Map();

  for (const з of история) {
    // Долю досмотра используем как силу сигнала: досмотренное до конца
    // говорит об интересе больше, чем брошенное на трети.
    const сила = 0.5 + з.ratio / 2;
    if (з.categoryId) {
      разделы.set(String(з.categoryId), (разделы.get(String(з.categoryId)) || 0) + сила);
    }
    if (з.channelId) {
      const ключ = `${з.channelType}:${з.channelId}`;
      каналы.set(ключ, (каналы.get(ключ) || 0) + сила);
    }
    if (з.lang) языки.set(з.lang, (языки.get(з.lang) || 0) + сила);
  }

  const подписан = new Set(подписки.map((п) => `${п.channelType}:${п.channelId}`));

  return { разделы, каналы, языки, подписан, естьИстория: история.length > 0 };
}

/** Оценка кандидата. Чем больше, тем выше в ленте. */
function оценить(video, п, сейчас) {
  let балл = 0;

  if (video.categoryId) {
    балл += ВЕС_РАЗДЕЛА * (п.разделы.get(String(video.categoryId)) || 0);
  }

  const ключКанала = video.clinicId
    ? `clinic:${video.clinicId}`
    : `user:${video.ownerId}`;
  балл += ВЕС_КАНАЛА * (п.каналы.get(ключКанала) || 0);
  if (п.подписан.has(ключКанала)) балл += ВЕС_ПОДПИСКИ;

  if (video.lang && п.языки.get(video.lang)) балл += ВЕС_ЯЗЫКА;

  // Популярность — логарифмом: иначе один старый ролик с тысячей просмотров
  // навсегда занял бы первую строку.
  балл += ВЕС_ПОПУЛЯРНОСТИ * Math.log10(1 + (video.stats?.views || 0));

  // Свежесть: полный вес в первую неделю, дальше плавно тает.
  const дней = video.publishedAt
    ? (сейчас - new Date(video.publishedAt).getTime()) / 86400000
    : 3650;
  балл += ВЕС_СВЕЖЕСТИ * Math.exp(-дней / 30);

  return балл;
}

/**
 * Лента «Рекомендации».
 *
 * @param {object} p
 * @param {object|null} p.viewer  зритель или null для гостя
 * @param {number} p.limit
 * @param {string} p.lang         язык интерфейса — мягкое предпочтение
 */
export async function рекомендации({ viewer = null, limit = 24, lang = "" } = {}) {
  const базовый = {
    visibility: "public",
    status: "ready",
    phi: false,
    archivedAt: null,
  };

  const поля =
    "title description lang kind media.posterKey media.durationSec publishedAt stats likes clinicId ownerId categoryId";

  // Гость и новичок: свежее сверху. Врать про «подобрано для вас» там,
  // где подбирать не из чего, не нужно.
  if (!viewer?.ownerId) {
    return Video.find(базовый)
      .sort({ publishedAt: -1 })
      .limit(limit)
      .select(поля)
      .lean();
  }

  const п = await портрет(viewer.ownerId);
  if (!п.естьИстория && п.подписан.size === 0) {
    return Video.find(базовый)
      .sort({ publishedAt: -1 })
      .limit(limit)
      .select(поля)
      .lean();
  }

  // Уже просмотренное из ленты убираем: показывать человеку то, что он
  // досмотрел вчера, — самый быстрый способ обесценить подборку.
  const просмотренные = await VideoInterest.find({ viewerId: viewer.ownerId })
    .select("videoId")
    .lean();
  const исключить = просмотренные.map((з) => з.videoId);

  // Кандидатов берём с запасом и ранжируем в памяти: сортировать по
  // составному баллу средствами Mongo пришлось бы агрегацией, которая
  // ради сотен документов не окупается.
  const кандидаты = await Video.find(
    исключить.length ? { ...базовый, _id: { $nin: исключить } } : базовый,
  )
    .sort({ publishedAt: -1 })
    .limit(Math.max(limit * 6, 120))
    .select(поля)
    .lean();

  if (lang) п.языки.set(lang, (п.языки.get(lang) || 0) + 1);

  const сейчас = Date.now();
  return кандидаты
    .map((v) => ({ v, балл: оценить(v, п, сейчас) }))
    .sort((a, b) => b.балл - a.балл)
    .slice(0, limit)
    .map((x) => x.v);
}

/** Похожие ролики — колонка справа на странице ролика. */
export async function похожие({ video, viewerId = null, limit = 12 }) {
  const базовый = {
    _id: { $ne: video._id },
    visibility: "public",
    status: "ready",
    phi: false,
    archivedAt: null,
  };

  const поля =
    "title lang kind media.posterKey media.durationSec publishedAt stats clinicId ownerId categoryId";

  const канал = video.clinicId
    ? { clinicId: video.clinicId }
    : { ownerId: video.ownerId, clinicId: null };

  // Сначала соседи по смыслу: тот же раздел или тот же автор. Это то, чего
  // ждёт человек, дочитавший разбор до конца.
  const близкие = await Video.find({
    ...базовый,
    $or: [
      ...(video.categoryId ? [{ categoryId: video.categoryId }] : []),
      канал,
    ],
  })
    .sort({ publishedAt: -1 })
    .limit(limit)
    .select(поля)
    .lean();

  if (близкие.length >= limit) return близкие;

  // Добираем свежим, чтобы колонка не пустовала на молодом каталоге.
  const взято = new Set(близкие.map((v) => String(v._id)));
  const остальные = await Video.find({
    ...базовый,
    _id: { $nin: [video._id, ...близкие.map((v) => v._id)] },
  })
    .sort({ publishedAt: -1 })
    .limit(limit - близкие.length)
    .select(поля)
    .lean();

  return [...близкие, ...остальные.filter((v) => !взято.has(String(v._id)))];
}

export default { запомнитьПросмотр, рекомендации, похожие };
