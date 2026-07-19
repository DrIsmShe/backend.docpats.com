// server/modules/notifications/services/webpush.service.js
//
// Отправка браузерных web-push уведомлений (VAPID). Полностью НЕОБЯЗАТЕЛЬНА:
// без VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY модуль в режиме no-op — уведомления
// в БД создаются как обычно, пуши просто не шлются.

import webpush from "web-push";
import PushSubscription from "../../../common/models/Notification/pushSubscription.js";

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:support@docpats.com";

let configured = false;
if (PUBLIC_KEY && PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
    configured = true;
  } catch (e) {
    console.warn("[webpush] VAPID setup failed:", e.message);
  }
}

export function isPushConfigured() {
  return configured;
}

export function getVapidPublicKey() {
  return PUBLIC_KEY;
}

/** Сохранить/обновить подписку браузера (upsert по endpoint). */
export async function saveSubscription(userId, sub, userAgent) {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    throw new Error("Invalid push subscription");
  }
  return PushSubscription.findOneAndUpdate(
    { endpoint: sub.endpoint },
    {
      userId,
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      userAgent: userAgent || null,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

/** Удалить подписку по endpoint. */
export async function removeSubscription(endpoint) {
  if (!endpoint) return { deletedCount: 0 };
  return PushSubscription.deleteOne({ endpoint });
}

/**
 * Отправить пуш всем подпискам пользователя. Fire-and-forget, никогда не
 * бросает. Мёртвые подписки (404/410) удаляются. No-op без VAPID.
 * @returns {Promise<number>} сколько успешно отправлено
 */
export async function sendToUser(userId, payload) {
  if (!configured || !userId) return 0;
  let subs;
  try {
    subs = await PushSubscription.find({ userId }).lean();
  } catch {
    return 0;
  }
  if (!subs.length) return 0;

  const body = JSON.stringify(payload || {});
  let sent = 0;
  await Promise.allSettled(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: s.keys },
          body,
        );
        sent += 1;
      } catch (err) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await PushSubscription.deleteOne({ endpoint: s.endpoint }).catch(
            () => {},
          );
        }
      }
    }),
  );
  return sent;
}

export default {
  isPushConfigured,
  getVapidPublicKey,
  saveSubscription,
  removeSubscription,
  sendToUser,
};
