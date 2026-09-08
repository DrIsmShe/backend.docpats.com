// server/modules/video/services/videoStats.service.js
//
// Что автору видно про свой ролик.
//
// ЗАЧЕМ. Автор видел одно число — просмотры. По нему нельзя понять
// главное: досматривают ли объяснение до конца. Ролик, который бросают на
// пятнадцатой секунде, не выполняет свою работу, и переснять его надо
// раньше, чем это заметит пациент, пришедший неподготовленным.
//
// ОТКУДА БЕРУТСЯ ЦИФРЫ. Из журнала событий video.watch — того самого, на
// котором держится видео-согласие. Он append-only и пишется синхронно,
// поэтому цифры здесь честные; витринный счётчик просмотров, наоборот,
// считает открытия страницы и накручивается перезагрузкой.
//
// ЭТО НЕ АНАЛИТИКА ЗРИТЕЛЕЙ. Мы не показываем, КТО смотрел: под роликом
// про подготовку к колоноскопии список зрителей — это список пациентов с
// подозрением на диагноз. Только числа.

import mongoose from "mongoose";
import Video from "../models/video.model.js";
import HIPAAAuditLog from "../../audit/models/AuditLog.model.js";
import { NotFoundError } from "../../../common/utils/errors.js";
import { canEdit } from "./video.service.js";

/** За какой срок считаем, если не сказано иначе. */
const ДНЕЙ_ПО_УМОЛЧАНИЮ = 30;

/**
 * Сводка по ролику для его владельца.
 *
 * @returns {Promise<object>} числа: просмотры, досмотры, средняя глубина
 */
export async function statsForVideo({ actor, id, days = ДНЕЙ_ПО_УМОЛЧАНИЮ }) {
  if (!mongoose.isValidObjectId(id)) throw new NotFoundError("Ролик не найден");

  const video = await Video.findById(id);
  if (!video) throw new NotFoundError("Ролик не найден");
  // Чужую статистику не показываем даже в клинике: это работа автора над
  // своим материалом, а не общий отчёт.
  if (!canEdit(video, actor)) throw new NotFoundError("Ролик не найден");

  const с = new Date(Date.now() - days * 86400000);

  const события = await HIPAAAuditLog.find({
    action: "video.watch",
    resourceId: video._id,
    createdAt: { $gte: с },
  })
    .select("metadata createdAt")
    .lean();

  const всего = события.length;
  const досмотрено = события.filter((с) => с.metadata?.completed).length;

  const доли = события
    .map((с) => Number(с.metadata?.ratio))
    .filter((д) => Number.isFinite(д) && д >= 0);

  const средняя = доли.length
    ? Math.round((доли.reduce((с, д) => с + д, 0) / доли.length) * 100)
    : 0;

  /* Где бросают. Пять равных отрезков: точнее без покадровой телеметрии
     всё равно не скажешь, а «бросают в первой трети» — уже достаточный
     повод пересобрать начало. */
  const отрезки = [0, 0, 0, 0, 0];
  for (const д of доли) {
    const i = Math.min(4, Math.floor(д * 5));
    отрезки[i] += 1;
  }

  return {
    videoId: String(video._id),
    title: video.title,
    days,
    // Счётчик витрины: открытия страницы, включая гостей.
    views: video.stats?.views || 0,
    // Засчитанные просмотры из журнала: только те, о ком мы знаем, сколько
    // он посмотрел.
    watches: всего,
    completions: досмотрено,
    completionRate: всего ? Math.round((досмотрено / всего) * 100) : 0,
    averageDepth: средняя,
    dropoff: отрезки,
    likes: (video.likes || []).length,
    dislikes: (video.dislikes || []).length,
  };
}

/**
 * Сводка по всем своим роликам — коротким списком.
 *
 * Нужна, чтобы автор увидел, какой ролик проседает, не открывая каждый.
 */
export async function statsForOwner({ actor, days = ДНЕЙ_ПО_УМОЛЧАНИЮ, limit = 50 }) {
  const ролики = await Video.find({
    ownerType: actor.ownerType,
    ownerId: actor.ownerId,
    archivedAt: null,
  })
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 200))
    .select("title stats likes dislikes visibility")
    .lean();

  if (!ролики.length) return { items: [], days };

  const с = new Date(Date.now() - days * 86400000);

  // Один запрос на все ролики: по запросу на ролик кабинет автора с
  // полусотней фильмов открывался бы секундами.
  const сводка = await HIPAAAuditLog.aggregate([
    {
      $match: {
        action: "video.watch",
        resourceId: { $in: ролики.map((р) => р._id) },
        createdAt: { $gte: с },
      },
    },
    {
      $group: {
        _id: "$resourceId",
        watches: { $sum: 1 },
        completions: {
          $sum: { $cond: [{ $eq: ["$metadata.completed", true] }, 1, 0] },
        },
        depth: { $avg: "$metadata.ratio" },
      },
    },
  ]);

  const поId = new Map(сводка.map((с) => [String(с._id), с]));

  return {
    days,
    items: ролики.map((р) => {
      const с = поId.get(String(р._id));
      return {
        _id: р._id,
        title: р.title,
        visibility: р.visibility,
        views: р.stats?.views || 0,
        watches: с?.watches || 0,
        completions: с?.completions || 0,
        completionRate: с?.watches
          ? Math.round((с.completions / с.watches) * 100)
          : 0,
        averageDepth: с?.depth ? Math.round(с.depth * 100) : 0,
        likes: (р.likes || []).length,
        dislikes: (р.dislikes || []).length,
      };
    }),
  };
}

export default { statsForVideo, statsForOwner };
