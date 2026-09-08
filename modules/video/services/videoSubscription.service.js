// server/modules/video/services/videoSubscription.service.js
//
// Подписка на канал: врача или клинику.
//
// ЗАЧЕМ ПОДПИСКА НУЖНА ЗДЕСЬ. Кнопка «Подписаться» без ленты — украшение.
// Поэтому вместе с самой подпиской тут живёт и выборка «ролики каналов, на
// которые я подписан»: это единственное, ради чего человек нажимает кнопку.
//
// КАНАЛ СУЩЕСТВУЕТ, ПОКА У НЕГО ЕСТЬ ПУБЛИЧНЫЙ РОЛИК. Отдельной сущности
// «канал» в продукте нет — есть врач и клиника. Подписаться можно только на
// того, чей ролик человек видит, иначе подписки превратились бы в способ
// перебирать идентификаторы пользователей.
//
// ЧИСЛО ПОДПИСЧИКОВ — ПУБЛИЧНОЕ, СПИСОК — НЕТ. Кто именно подписан на
// онколога, не должно быть видно никому: это выдаёт диагноз подписчика.

import mongoose from "mongoose";
import VideoSubscription from "../models/videoSubscription.model.js";
import Video from "../models/video.model.js";
import { NotFoundError, ForbiddenError, ValidationError } from "../../../common/utils/errors.js";
import { recordActionAsync } from "../../audit/services/audit.service.js";

/** Канал ролика: клиника, если ролик принадлежит клинике, иначе автор. */
export function каналРолика(video) {
  return video.clinicId
    ? { channelType: "clinic", channelId: video.clinicId }
    : { channelType: "user", channelId: video.ownerId };
}

/**
 * Проверить, что канал действительно кому-то показан.
 *
 * Подписка выдаётся не на произвольный идентификатор, а на автора,
 * у которого есть хотя бы один опубликованный ролик.
 */
async function каналПоказан({ channelType, channelId }) {
  const условие =
    channelType === "clinic" ? { clinicId: channelId } : { ownerId: channelId, clinicId: null };

  const есть = await Video.exists({
    ...условие,
    visibility: "public",
    status: "ready",
    phi: false,
    archivedAt: null,
  });
  return Boolean(есть);
}

function разобратьКанал(channelType, channelId) {
  if (!["user", "clinic"].includes(channelType)) {
    throw new ValidationError("Неизвестный тип канала");
  }
  if (!mongoose.isValidObjectId(channelId)) throw new NotFoundError("Канал не найден");
  return { channelType, channelId: new mongoose.Types.ObjectId(String(channelId)) };
}

/** Сколько человек подписано на канал. */
export async function countSubscribers({ channelType, channelId }) {
  if (!channelId) return 0;
  return VideoSubscription.countDocuments({ channelType, channelId });
}

/** Подписан ли конкретный зритель. Гость — нет. */
export async function isSubscribed({ viewerId, channelType, channelId }) {
  if (!viewerId || !channelId) return false;
  const есть = await VideoSubscription.exists({
    subscriberId: viewerId,
    channelType,
    channelId,
  });
  return Boolean(есть);
}

/**
 * Подписаться или отписаться — одно действие, как и кнопка в интерфейсе.
 *
 * @returns {{subscribed: boolean, subscribers: number}}
 */
export async function toggleSubscription({ actor, channelType, channelId }) {
  if (actor.ownerType !== "user") {
    throw new ForbiddenError("Подписывается человек, а не сотрудник клиники");
  }
  const канал = разобратьКанал(channelType, channelId);

  // На себя не подписываются: счётчик, который автор накручивает сам себе,
  // перестаёт что-либо значить.
  if (канал.channelType === "user" && String(канал.channelId) === String(actor.ownerId)) {
    throw new ValidationError("Нельзя подписаться на самого себя");
  }

  if (!(await каналПоказан(канал))) throw new NotFoundError("Канал не найден");

  const была = await VideoSubscription.findOne({
    subscriberId: actor.ownerId,
    ...канал,
  });

  if (была) {
    await VideoSubscription.deleteOne({ _id: была._id });
  } else {
    // Гонка двух вкладок упирается в уникальный индекс — повторную запись
    // считаем успехом, а не ошибкой.
    try {
      await VideoSubscription.create({ subscriberId: actor.ownerId, ...канал });
    } catch (e) {
      if (e?.code !== 11000) throw e;
    }
  }

  const subscribers = await countSubscribers(канал);

  recordActionAsync({
    actor: {
      userId: actor.ownerId,
      email: actor.email || null,
      role: actor.role || null,
    },
    action: "video.subscribe",
    resourceType: "video-channel",
    resourceId: канал.channelId,
    metadata: { channelType: канал.channelType, subscribed: !была, subscribers },
  });

  return { subscribed: !была, subscribers };
}

/** Каналы, на которые подписан зритель. */
export async function listMySubscriptions({ actor }) {
  if (actor.ownerType !== "user") return [];
  return VideoSubscription.find({ subscriberId: actor.ownerId }).lean();
}

/**
 * Условие выборки «ролики моих каналов» — для витрины.
 *
 * Возвращает null, если подписок нет: вызывающий покажет пустую ленту, а не
 * весь каталог. Пустой $or в Mongo — ошибка запроса, поэтому именно null.
 */
export async function фильтрПодписок({ actor }) {
  const подписки = await listMySubscriptions({ actor });
  if (!подписки.length) return null;

  const клиники = подписки.filter((п) => п.channelType === "clinic").map((п) => п.channelId);
  const люди = подписки.filter((п) => п.channelType === "user").map((п) => п.channelId);

  const условия = [];
  if (клиники.length) условия.push({ clinicId: { $in: клиники } });
  if (люди.length) условия.push({ ownerId: { $in: люди }, clinicId: null });

  return условия.length ? { $or: условия } : null;
}

export default {
  каналРолика,
  countSubscribers,
  isSubscribed,
  toggleSubscription,
  listMySubscriptions,
  фильтрПодписок,
};
