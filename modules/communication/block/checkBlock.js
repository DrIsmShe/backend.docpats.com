// server/src/communication/block/checkBlock.js
//
// Утилита: проверить блокировку между участниками диалога.
// Используется и в socket.gateway.js и в blockCheckMiddleware.js

import User from "../../../common/models/Auth/users.js";
import DialogParticipant from "../dialogs/dialogParticipant.model.js";
import mongoose from "mongoose";

/**
 * Найти peerId в приватном диалоге (участник, который не senderId).
 * Возвращает ObjectId или null.
 */
export async function getPeerIdInDialog(dialogId, senderId) {
  const participants = await DialogParticipant.find({
    dialogId: new mongoose.Types.ObjectId(dialogId),
    isRemoved: { $ne: true },
  }).select("userId");

  if (participants.length !== 2) return null;

  const peer = participants.find((p) => String(p.userId) !== String(senderId));
  return peer ? peer.userId : null;
}

/**
 * Проверить блокировку между senderId и peerId.
 *
 * @returns {{ blocked: boolean, reason: 'you_blocked_peer' | 'blocked_by_peer' | null }}
 */
export async function checkBlockBetween(senderId, peerId) {
  if (!peerId) return { blocked: false, reason: null };

  const [sender, peer] = await Promise.all([
    User.findById(senderId).select("blockedContacts"),
    User.findById(peerId).select("blockedContacts"),
  ]);

  if (!sender || !peer) return { blocked: false, reason: null };

  if (sender.blockedContacts.some((id) => String(id) === String(peerId))) {
    return { blocked: true, reason: "you_blocked_peer" };
  }

  if (peer.blockedContacts.some((id) => String(id) === String(senderId))) {
    return { blocked: true, reason: "blocked_by_peer" };
  }

  return { blocked: false, reason: null };
}
