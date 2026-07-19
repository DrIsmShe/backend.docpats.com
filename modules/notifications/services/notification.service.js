// server/modules/notifications/services/notification.service.js
//
// Единая точка для создания и чтения уведомлений (Stage 1 / C1).
//
// ЦЕЛЬ: убрать разрозненные Notification.create(...) по кодовой базе и
// две несогласованные формы ответа. Все эмиттеры (consent, appointments,
// chat, ...) должны звать notify()/notifyMany(); чтение идёт через единые
// списочные хелперы с одинаковой формой.
//
// Модель Notification привязана к userId (User). Получатели — пациенты и
// члены клиники, у которых есть User._id (owner/doctor через /login).
// ClinicEmployee (employee-login) под текущей моделью не адресуются —
// отдельное расширение (recipientEmployeeId) при необходимости.

import mongoose from "mongoose";
import Notification from "../../../common/models/Notification/notification.js";
import { sendToUser } from "./webpush.service.js";

const VALID_PRIORITIES = new Set(["low", "normal", "high"]);

function toId(v) {
  if (!v) return null;
  if (v instanceof mongoose.Types.ObjectId) return v;
  return mongoose.Types.ObjectId.isValid(v)
    ? new mongoose.Types.ObjectId(v)
    : null;
}

/**
 * Создать одно уведомление.
 *
 * @param {object} p
 * @param {string|ObjectId} p.userId   получатель (обязательно)
 * @param {string} p.type              из enum модели Notification
 * @param {string} p.title             заголовок (обязательно)
 * @param {string} p.message           текст (обязательно)
 * @param {string|null} [p.link]       куда вести по клику
 * @param {object} [p.meta]            произвольные метаданные (не PHI)
 * @param {"low"|"normal"|"high"} [p.priority]
 * @param {string} [p.icon]
 * @param {string|ObjectId|null} [p.senderId]
 * @returns {Promise<Notification|null>}  null если задублировалось (dedup-индекс)
 */
export async function notify({
  userId,
  type = "system_message",
  title,
  message,
  link = null,
  meta = {},
  priority = "normal",
  icon = "bell",
  senderId = null,
} = {}) {
  const uid = toId(userId);
  if (!uid) throw new Error("notify: valid userId is required");
  if (!title || !message) {
    throw new Error("notify: title and message are required");
  }

  try {
    const doc = await Notification.create({
      userId: uid,
      senderId: toId(senderId),
      type,
      title: String(title),
      message: String(message),
      link: link || null,
      meta: meta && typeof meta === "object" ? meta : {},
      priority: VALID_PRIORITIES.has(priority) ? priority : "normal",
      icon: icon || "bell",
    });

    // Браузерный web-push (fire-and-forget; no-op без VAPID-ключей).
    sendToUser(uid, {
      title: String(title),
      body: String(message),
      url: link || "/",
    }).catch(() => {});

    return doc;
  } catch (err) {
    // E11000 — сработал dedup-индекс (userId, senderId, type, message).
    // Это не фатально: такое же уведомление уже есть. Возвращаем null.
    if (err?.code === 11000) return null;
    throw err;
  }
}

/**
 * Разослать одинаковое уведомление нескольким получателям.
 * Fire-and-forget по элементам — один сбой не валит остальные.
 *
 * @param {Array<string|ObjectId>} userIds
 * @param {object} payload  как в notify(), без userId
 * @returns {Promise<number>}  сколько реально создано
 */
export async function notifyMany(userIds = [], payload = {}) {
  if (!Array.isArray(userIds) || userIds.length === 0) return 0;
  const results = await Promise.allSettled(
    userIds.map((uid) => notify({ ...payload, userId: uid })),
  );
  return results.filter((r) => r.status === "fulfilled" && r.value).length;
}

/**
 * Список уведомлений пользователя (единая форма).
 *
 * @param {string|ObjectId} userId
 * @param {object} [opts]
 * @param {"all"|"unread"|"read"} [opts.status="all"]
 * @param {number} [opts.limit=50]   максимум 100
 * @param {string|Date} [opts.before]  cursor по createdAt (для пагинации)
 * @returns {Promise<Array>}
 */
export async function listForUser(userId, opts = {}) {
  const uid = toId(userId);
  if (!uid) return [];

  const { status = "all", limit = 50, before } = opts;

  const filter = { userId: uid };
  if (status === "unread") filter.isRead = false;
  else if (status === "read") filter.isRead = true;
  if (before) {
    const d = new Date(before);
    if (!Number.isNaN(d.getTime())) filter.createdAt = { $lt: d };
  }

  return Notification.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 50, 100))
    .lean();
}

/** Количество непрочитанных. */
export async function unreadCount(userId) {
  const uid = toId(userId);
  if (!uid) return 0;
  return Notification.countDocuments({ userId: uid, isRead: false });
}

/** Пометить одно прочитанным (только своё). */
export async function markRead(userId, id) {
  const uid = toId(userId);
  const nid = toId(id);
  if (!uid || !nid) return { matchedCount: 0, modifiedCount: 0 };
  return Notification.updateOne(
    { _id: nid, userId: uid },
    { $set: { isRead: true } },
  );
}

/** Пометить все прочитанными. */
export async function markAllRead(userId) {
  const uid = toId(userId);
  if (!uid) return { matchedCount: 0, modifiedCount: 0 };
  return Notification.updateMany(
    { userId: uid, isRead: false },
    { $set: { isRead: true } },
  );
}

/** Удалить одно (только своё). */
export async function remove(userId, id) {
  const uid = toId(userId);
  const nid = toId(id);
  if (!uid || !nid) return { deletedCount: 0 };
  return Notification.deleteOne({ _id: nid, userId: uid });
}

export default {
  notify,
  notifyMany,
  listForUser,
  unreadCount,
  markRead,
  markAllRead,
  remove,
};
