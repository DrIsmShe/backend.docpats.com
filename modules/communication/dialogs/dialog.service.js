import DialogModel from "./dialog.model.js";
import DialogParticipant from "./dialogParticipant.model.js";
import ChatMessage from "../messages/message.model.js";
import User from "../../../common/models/Auth/users.js";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";
import mongoose from "mongoose";
const BACKEND_URL =
  process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 11000}`;

const buildAvatarUrl = (path) => {
  if (!path) return null;
  if (path.startsWith("http")) return path; // уже полный URL
  if (path.startsWith("/uploads")) return `${BACKEND_URL}${path}`; // локальный файл
  return `${process.env.R2_PUBLIC_URL}/${path}`; // R2 ключ
};

// ==========================================
// СОЗДАТЬ ДИАЛОГ
// ==========================================
export async function createDialog({ creatorId, participantIds, type }) {
  const dialog = await DialogModel.create({
    type,
    createdBy: creatorId,
  });

  const uniqueParticipantIds = [...new Set([...participantIds, creatorId])];

  const users = await User.find({
    _id: { $in: uniqueParticipantIds },
  }).select("_id role");

  const participants = users.map((user) => ({
    dialogId: dialog._id,
    userId: user._id,
    roleInDialog: user.role,
  }));

  await DialogParticipant.insertMany(participants);

  return dialog;
}

// ==========================================
// ПОЛУЧИТЬ ДИАЛОГ
// ==========================================
export async function getDialogById({ userId, dialogId }) {
  const isParticipant = await DialogParticipant.exists({ dialogId, userId });
  if (!isParticipant) {
    throw new Error("Forbidden");
  }

  return DialogModel.findById(dialogId);
}

// ==========================================
// СОЗДАТЬ ИЛИ НАЙТИ ПРИВАТНЫЙ
// ==========================================
export async function getOrCreatePrivateDialog({ currentUserId, peerUserId }) {
  if (!currentUserId || !peerUserId) {
    throw new Error("currentUserId и peerUserId обязательны");
  }

  const sortedIds = [currentUserId.toString(), peerUserId.toString()].sort();
  const participantsKey = sortedIds.join("_");

  let dialog = await DialogModel.findOne({
    type: "private",
    participantsKey,
    isDeleted: { $ne: true },
  });

  if (!dialog) {
    dialog = await DialogModel.create({
      type: "private",
      createdBy: currentUserId,
      participantsKey,
    });
  }

  await DialogParticipant.updateOne(
    { dialogId: dialog._id, userId: currentUserId },
    {
      $setOnInsert: {
        dialogId: dialog._id,
        userId: currentUserId,
        roleInDialog: "doctor",
      },
    },
    { upsert: true },
  );

  await DialogParticipant.updateOne(
    { dialogId: dialog._id, userId: peerUserId },
    {
      $setOnInsert: {
        dialogId: dialog._id,
        userId: peerUserId,
        roleInDialog: "doctor",
      },
    },
    { upsert: true },
  );

  return dialog;
}

// ==========================================
// СПИСОК ДИАЛОГОВ
// ==========================================
export async function getDialogsForUser(userId) {
  const myParticipants = await DialogParticipant.find({
    userId,
    isRemoved: { $ne: true },
  });

  if (!myParticipants.length) return [];

  const dialogIds = myParticipants.map((p) => p.dialogId);

  const dialogs = await DialogModel.find({
    _id: { $in: dialogIds },
    isDeleted: { $ne: true },
  }).sort({ lastMessageAt: -1 });

  const allParticipants = await DialogParticipant.find({
    dialogId: { $in: dialogIds },
    isRemoved: { $ne: true },
  }).populate({
    path: "userId",
    select: "username avatar firstNameEncrypted lastNameEncrypted role",
  });

  const validParticipants = allParticipants.filter(
    (p) => p.userId && typeof p.userId === "object" && p.userId._id,
  );

  // ✅ Собираем userId всех "других" участников для batch-запроса DoctorProfile
  const otherUserIds = new Set();
  for (const dialog of dialogs) {
    const participants = validParticipants.filter(
      (p) => String(p.dialogId) === String(dialog._id),
    );
    const otherUser = participants
      .map((p) => p.userId)
      .find((u) => String(u._id) !== String(userId));
    if (otherUser) otherUserIds.add(String(otherUser._id));
  }

  // ✅ Один запрос за все DoctorProfile сразу
  const doctorProfiles = await ProfileDoctor.find({
    userId: { $in: [...otherUserIds] },
  }).select("userId profileImage");

  const doctorProfileMap = {};
  for (const dp of doctorProfiles) {
    doctorProfileMap[String(dp.userId)] = dp;
  }

  const result = [];

  for (const dialog of dialogs) {
    const participants = validParticipants.filter(
      (p) => String(p.dialogId) === String(dialog._id),
    );

    const myParticipant = participants.find(
      (p) => String(p.userId._id) === String(userId),
    );

    const otherUser = participants
      .map((p) => p.userId)
      .find((u) => String(u._id) !== String(userId));

    // =============================
    // ИМЯ ДИАЛОГА
    // =============================
    let displayName;

    if (dialog.type === "private") {
      if (otherUser) {
        const userObj = otherUser.toObject
          ? otherUser.toObject({ virtuals: true })
          : otherUser;

        const fullName =
          `${userObj.firstName || ""} ${userObj.lastName || ""}`.trim();

        displayName =
          fullName ||
          userObj.username ||
          `Dialog ${String(dialog._id).slice(-4)}`;
      } else {
        displayName = `Dialog ${String(dialog._id).slice(-4)}`;
      }
    } else {
      displayName = dialog.title || `Dialog ${String(dialog._id).slice(-4)}`;
    }

    // =============================
    // НЕПРОЧИТАННЫЕ
    // =============================
    let unreadCount = 0;

    if (myParticipant?.lastReadAt) {
      unreadCount = await ChatMessage.countDocuments({
        dialogId: dialog._id,
        senderId: { $ne: userId },
        createdAt: { $gt: myParticipant.lastReadAt },
        isDeleted: { $ne: true },
      });
    } else {
      unreadCount = await ChatMessage.countDocuments({
        dialogId: dialog._id,
        senderId: { $ne: userId },
        isDeleted: { $ne: true },
      });
    }

    const otherUserObj = otherUser?.toObject
      ? otherUser.toObject({ virtuals: true })
      : otherUser;

    // ✅ Приоритет аватара:
    // 1. profileImage из DoctorProfile (реальное фото врача)
    // 2. avatar из User (дефолтный аватар)
    // 3. null
    let avatarPath = null;
    if (dialog.type === "private" && otherUserObj) {
      const dp = doctorProfileMap[String(otherUserObj._id)];
      avatarPath = dp?.profileImage || otherUserObj.avatar || null;
    } else {
      avatarPath = dialog.avatarUrl || null;
    }

    result.push({
      _id: dialog._id,
      type: dialog.type,
      displayName,
      avatarUrl: buildAvatarUrl(avatarPath),
      lastMessagePreview: dialog.lastMessagePreview || null,
      lastMessageAt: dialog.lastMessageAt || null,
      unreadCount,
      peerUser: otherUserObj || null,
    });
  }

  return result.filter(Boolean);
}

// ─── ДОБАВИТЬ в dialog.service.js ────────────────────────────────────────────
//
// Функция поиска по диалогам и сообщениям пользователя.
// Добавь этот экспорт в конец файла.

/**
 * Поиск по диалогам (имя собеседника) и сообщениям (текст)
 * @param {{ userId: string, q: string }} params
 * @returns {{ dialogs: DialogSearchResult[], messages: MessageSearchResult[] }}
 */
export async function searchDialogsAndMessages({ userId, q }) {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); // safe regex

  // ── 1. Диалоги пользователя ───────────────────────────────────────────────
  const myParticipants = await DialogParticipant.find({
    userId: userObjectId,
    isRemoved: { $ne: true },
  }).lean();

  if (!myParticipants.length) return { dialogs: [], messages: [] };

  const dialogIds = myParticipants.map((p) => p.dialogId);

  // ── 2. Все участники этих диалогов с данными юзеров ──────────────────────
  const allParticipants = await DialogParticipant.find({
    dialogId: { $in: dialogIds },
    isRemoved: { $ne: true },
  }).populate({
    path: "userId",
    select:
      "username avatar firstName lastName firstNameEncrypted lastNameEncrypted role",
  });

  // ── 3. Все диалоги ────────────────────────────────────────────────────────
  const dialogs = await DialogModel.find({
    _id: { $in: dialogIds },
    isDeleted: { $ne: true },
  }).lean();

  // ── 4. DoctorProfile аватарки ─────────────────────────────────────────────
  const otherUserIds = new Set();
  for (const dp of allParticipants) {
    if (dp.userId && String(dp.userId._id) !== String(userId)) {
      otherUserIds.add(String(dp.userId._id));
    }
  }
  const doctorProfiles = await ProfileDoctor.find({
    userId: { $in: [...otherUserIds] },
  })
    .select("userId profileImage")
    .lean();
  const profileMap = {};
  for (const dp of doctorProfiles) {
    profileMap[String(dp.userId)] = dp;
  }

  // ── 5. Собираем карту диалог → peer ──────────────────────────────────────
  const dialogMap = {};
  for (const dialog of dialogs) {
    const key = String(dialog._id);
    const participants = allParticipants.filter(
      (p) => String(p.dialogId) === key && p.userId,
    );
    const peerParticipant = participants.find(
      (p) => String(p.userId._id) !== String(userId),
    );
    const peerUser = peerParticipant?.userId || null;

    let displayName;
    if (dialog.type === "private" && peerUser) {
      const fullName =
        `${peerUser.firstName || ""} ${peerUser.lastName || ""}`.trim();
      displayName = fullName || peerUser.username || `Dialog ${key.slice(-4)}`;
    } else {
      displayName = dialog.title || `Dialog ${key.slice(-4)}`;
    }

    let avatarPath = null;
    if (peerUser) {
      const dp = profileMap[String(peerUser._id)];
      avatarPath = dp?.profileImage || peerUser.avatar || null;
    }

    dialogMap[key] = {
      _id: dialog._id,
      type: dialog.type,
      displayName,
      avatarUrl: buildAvatarUrl(avatarPath),
      lastMessageAt: dialog.lastMessageAt || null,
      peerUser: peerUser || null,
    };
  }

  // ── 6. Поиск диалогов по имени собеседника ────────────────────────────────
  const matchedDialogs = Object.values(dialogMap).filter((d) =>
    regex.test(d.displayName),
  );

  // ── 7. Поиск сообщений по тексту ─────────────────────────────────────────
  const matchedMessages = await ChatMessage.find({
    dialogId: { $in: dialogIds },
    text: { $regex: regex },
    isDeleted: { $ne: true },
  })
    .sort({ createdAt: -1 })
    .limit(40)
    .populate("senderId", "username firstName lastName avatar")
    .lean();

  // Группируем сообщения по диалогу — берём только первые 3 на диалог
  const msgByDialog = {};
  for (const msg of matchedMessages) {
    const key = String(msg.dialogId);
    if (!msgByDialog[key]) msgByDialog[key] = [];
    if (msgByDialog[key].length < 3) {
      msgByDialog[key].push({
        _id: msg._id,
        text: msg.text,
        createdAt: msg.createdAt,
        sender: msg.senderId,
        dialogId: msg.dialogId,
        dialog: dialogMap[key] || null,
      });
    }
  }

  const messageResults = Object.values(msgByDialog).flat();

  return {
    dialogs: matchedDialogs,
    messages: messageResults,
  };
}
