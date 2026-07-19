// server/modules/notifications/controllers/push.controller.js
//
// Управление web-push подпиской: отдать публичный VAPID-ключ, подписать/
// отписать текущего пользователя.

import {
  saveSubscription,
  removeSubscription,
  getVapidPublicKey,
  isPushConfigured,
} from "../services/webpush.service.js";

// GET /notifications/push/public-key  (публично)
export async function getPushPublicKey(req, res) {
  return res.status(200).json({
    success: true,
    enabled: isPushConfigured(),
    publicKey: getVapidPublicKey() || null,
  });
}

// POST /notifications/push/subscribe  (auth)
export async function subscribePush(req, res) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Not authenticated" });
    }
    if (!isPushConfigured()) {
      return res
        .status(503)
        .json({ success: false, message: "Push not configured" });
    }
    const sub = req.body?.subscription || req.body;
    await saveSubscription(userId, sub, req.get("user-agent"));
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

// POST /notifications/push/unsubscribe  (auth)
export async function unsubscribePush(req, res) {
  try {
    const endpoint = req.body?.endpoint || req.body?.subscription?.endpoint;
    await removeSubscription(endpoint);
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}
