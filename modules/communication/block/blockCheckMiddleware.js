// server/src/communication/block/blockCheckMiddleware.js
//
// Middleware для HTTP: POST /communication/messages
// Вставить МЕЖДУ authMiddleware и контроллером отправки сообщения.

import { checkBlockBetween, getPeerIdInDialog } from "./checkBlock.js";

export async function blockCheckMiddleware(req, res, next) {
  try {
    const senderId = req.session.userId;
    const { dialogId } = req.body;

    if (!dialogId) return next();

    const peerId = await getPeerIdInDialog(dialogId, senderId);
    const { blocked, reason } = await checkBlockBetween(senderId, peerId);

    if (blocked) {
      return res.status(403).json({ error: "Message blocked", reason });
    }

    next();
  } catch (err) {
    console.error("blockCheckMiddleware error:", err);
    next();
  }
}
