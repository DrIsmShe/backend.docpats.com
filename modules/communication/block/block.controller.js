// server/src/communication/block/block.controller.js

import User from "../../../common/models/Auth/users.js";
import mongoose from "mongoose";

// ======================================================
// GET /communication/block/status/:peerId
// Проверить — заблокирован ли peerId текущим юзером
// ======================================================
export async function getBlockStatus(req, res) {
  try {
    const currentUserId = req.user?._id || req.user?.id;
    if (!currentUserId) return res.status(401).json({ error: "Unauthorized" });
    const { peerId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(peerId)) {
      return res.status(400).json({ error: "Invalid peerId" });
    }

    const me = await User.findById(currentUserId).select("blockedContacts");
    if (!me) return res.status(404).json({ error: "User not found" });

    const isBlocked = me.blockedContacts.some(
      (id) => String(id) === String(peerId),
    );

    // Также проверим — не заблокировал ли нас собеседник
    const peer = await User.findById(peerId).select("blockedContacts");
    const blockedByPeer = peer
      ? peer.blockedContacts.some((id) => String(id) === String(currentUserId))
      : false;

    return res.json({ isBlocked, blockedByPeer });
  } catch (err) {
    console.error("getBlockStatus error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

// ======================================================
// POST /communication/block/:peerId
// Заблокировать пользователя
// ======================================================
export async function blockUser(req, res) {
  try {
    const currentUserId = req.user?._id || req.user?.id;
    if (!currentUserId) return res.status(401).json({ error: "Unauthorized" });
    const { peerId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(peerId)) {
      return res.status(400).json({ error: "Invalid peerId" });
    }

    if (String(currentUserId) === String(peerId)) {
      return res.status(400).json({ error: "Cannot block yourself" });
    }

    await User.updateOne(
      { _id: currentUserId },
      { $addToSet: { blockedContacts: peerId } }, // addToSet — не дублирует
    );

    return res.json({ success: true, isBlocked: true });
  } catch (err) {
    console.error("blockUser error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

// ======================================================
// DELETE /communication/block/:peerId
// Разблокировать пользователя
// ======================================================
export async function unblockUser(req, res) {
  try {
    const currentUserId = req.user?._id || req.user?.id;
    if (!currentUserId) return res.status(401).json({ error: "Unauthorized" });
    const { peerId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(peerId)) {
      return res.status(400).json({ error: "Invalid peerId" });
    }

    await User.updateOne(
      { _id: currentUserId },
      { $pull: { blockedContacts: new mongoose.Types.ObjectId(peerId) } },
    );

    return res.json({ success: true, isBlocked: false });
  } catch (err) {
    console.error("unblockUser error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
