// server/modules/communication/socket_gateway.js
import DialogParticipant from "../dialogs/dialogParticipant.model.js";
import * as messageService from "../messages/message.service.js";
import Dialog from "../dialogs/dialog.model.js";
import mongoose from "mongoose";
import ChatMessageModel from "../messages/message.model.js";
import { checkBlockBetween, getPeerIdInDialog } from "../block/checkBlock.js";
import {
  translateMessage,
  SUPPORTED_LANGUAGES,
} from "../chat-translation/messageTranslation.service.js";
let ioInstance = null;

export async function getDialogsForUser(userId) {
  const participants = await DialogParticipant.find({
    userId,
    isRemoved: { $ne: true },
  }).select("dialogId");

  const dialogIds = participants.map((p) => p.dialogId);

  const dialogs = await Dialog.find({
    _id: { $in: dialogIds },
  })
    .sort({ lastMessageAt: -1 })
    .lean();

  return dialogs;
}

export function initCommunicationGateway(nsp) {
  ioInstance = nsp;

  nsp.use((socket, next) => {
    const session = socket.request.session;
    if (!session || !session.userId) {
      return next(new Error("Not authenticated"));
    }
    socket.user = { id: session.userId };
    next();
  });

  nsp.on("connection", (socket) => {
    const userId = socket.user.id;

    console.log("🔥 SOCKET CONNECTED:", userId);

    // Личная комната для каждого пользователя (для push событий)
    socket.join(`user:${userId}`);

    nsp.emit("user:online", { userId });

    // ======================================================
    // JOIN DIALOG
    // ======================================================
    socket.on("dialog:join", async ({ dialogId }) => {
      try {
        if (!dialogId) return;

        const dialogObjectId = new mongoose.Types.ObjectId(dialogId);
        const userObjectId = new mongoose.Types.ObjectId(userId);

        const isParticipant = await DialogParticipant.exists({
          dialogId: dialogObjectId,
          userId: userObjectId,
          isRemoved: { $ne: true },
        });

        if (!isParticipant) {
          console.log("❌ NOT PARTICIPANT:", userId, dialogId);
          return;
        }

        socket.join(`room:dialog:${dialogId}`);
        console.log("✅ JOIN:", dialogId);

        // ✅ FIX: При входе в диалог — отмечаем все сообщения как прочитанные
        await _markDialogRead(nsp, dialogId, userId);
      } catch (error) {
        console.error("dialog:join error:", error);
      }
    });

    // ======================================================
    // LEAVE DIALOG
    // ======================================================
    socket.on("dialog:leave", ({ dialogId }) => {
      if (!dialogId) return;
      socket.leave(`room:dialog:${dialogId}`);
      console.log("🚪 LEFT:", dialogId);
    });

    // ======================================================
    // MARK DIALOG READ (явный вызов с клиента)
    // ======================================================
    socket.on("dialog:markRead", async ({ dialogId }) => {
      try {
        if (!dialogId) return;
        await _markDialogRead(nsp, dialogId, userId);
      } catch (error) {
        console.error("dialog:markRead error:", error);
      }
    });

    // ======================================================
    // SEND MESSAGE
    // ======================================================
    socket.on("message:send", async (payload = {}) => {
      try {
        const { tempId, dialogId, type, text, attachments } = payload;
        if (!dialogId) return;

        console.log("MESSAGE SEND:", payload);

        const peerId = await getPeerIdInDialog(dialogId, userId);
        const { blocked, reason } = await checkBlockBetween(userId, peerId);
        if (blocked) {
          socket.emit("message:blocked", { dialogId, reason });
          return;
        }

        const message = await messageService.sendMessage({
          userId,
          dialogId,
          type,
          text,
          attachments,
        });

        // Уведомляем всех в открытом диалоге (чат окно)
        nsp.to(`room:dialog:${dialogId}`).emit("message:new", {
          dialogId,
          tempId: tempId || null,
          message,
        });

        // Уведомляем собеседника через его личную комнату ТОЛЬКО если он не
        // сидит в room:dialog (иначе он уже получил выше — дубль не нужен)
        if (peerId) {
          const roomName = `room:dialog:${dialogId}`;
          const room = nsp.adapter.rooms.get(roomName);
          // Ищем сокеты peerId в этой room
          const peerSockets = await nsp.in(`user:${peerId}`).fetchSockets();
          const peerInRoom = peerSockets.some((s) => s.rooms.has(roomName));

          if (!peerInRoom) {
            nsp.to(`user:${peerId}`).emit("message:new", {
              dialogId,
              tempId: tempId || null,
              message,
            });
          }
        }
      } catch (error) {
        console.error("message:send error:", error);
      }
    });

    // ======================================================
    // DELETE MESSAGE
    // ======================================================
    socket.on("message:delete", async ({ messageId }) => {
      console.log("🗑 DELETE REQUEST:", messageId, "from", userId);
      try {
        if (!messageId) return;

        const message = await ChatMessageModel.findById(messageId);
        if (!message) return;

        if (String(message.senderId) !== String(userId)) return;

        const DELETE_TIME_LIMIT_MS = 10 * 60 * 1000;
        const messageAge = Date.now() - new Date(message.createdAt).getTime();
        if (messageAge > DELETE_TIME_LIMIT_MS) return;

        message.isDeleted = true;
        message.deletedAt = new Date();
        message.deletedBy = userId;
        message.text = "";
        message.reactions = [];

        await message.save();

        nsp.to(`room:dialog:${message.dialogId}`).emit("message:deleted", {
          dialogId: message.dialogId,
          messageId,
        });
      } catch (error) {
        console.error("message:delete error:", error);
      }
    });

    // ======================================================
    // REACT TO MESSAGE
    // ======================================================
    socket.on(
      "message:react",
      async ({ messageId, dialogId, emoji, action }) => {
        try {
          if (!messageId || !dialogId || !emoji) return;

          const isParticipant = await DialogParticipant.exists({
            dialogId: new mongoose.Types.ObjectId(dialogId),
            userId: new mongoose.Types.ObjectId(userId),
            isRemoved: { $ne: true },
          });
          if (!isParticipant) return;

          const message = await ChatMessageModel.findById(messageId).select(
            "isDeleted reactions dialogId",
          );
          if (!message || message.isDeleted) return;
          if (String(message.dialogId) !== String(dialogId)) return;

          if (action === "add") {
            const alreadyReacted = message.reactions.some(
              (r) => r.emoji === emoji && String(r.userId) === String(userId),
            );
            if (!alreadyReacted) {
              await ChatMessageModel.updateOne(
                { _id: messageId },
                { $push: { reactions: { emoji, userId } } },
              );
            }
          } else {
            await ChatMessageModel.updateOne(
              { _id: messageId },
              { $pull: { reactions: { emoji, userId } } },
            );
          }

          nsp.to(`room:dialog:${dialogId}`).emit("message:reaction", {
            messageId,
            emoji,
            userId,
            action,
          });
        } catch (error) {
          console.error("message:react error:", error);
        }
      },
    );

    // ======================================================
    // TYPING EVENTS
    // ======================================================
    socket.on("typing:start", ({ dialogId }) => {
      if (!dialogId) return;
      socket
        .to(`room:dialog:${dialogId}`)
        .emit("typing:start", { dialogId, userId });
    });

    socket.on("typing:stop", ({ dialogId }) => {
      if (!dialogId) return;
      socket
        .to(`room:dialog:${dialogId}`)
        .emit("typing:stop", { dialogId, userId });
    });
    socket.on("translation:request", async ({ messageId, targetLang } = {}) => {
      try {
        if (!messageId || !targetLang) return;

        // Проверка поддерживаемого языка
        if (!SUPPORTED_LANGUAGES[targetLang]) {
          socket.emit("translation:error", {
            messageId,
            error: `Язык "${targetLang}" не поддерживается`,
          });
          return;
        }

        // Загружаем сообщение
        const message = await ChatMessageModel.findById(messageId).select(
          "text dialogId isDeleted type",
        );

        if (
          !message ||
          message.isDeleted ||
          message.type !== "text" ||
          !message.text
        ) {
          socket.emit("translation:error", {
            messageId,
            error: "Сообщение недоступно для перевода",
          });
          return;
        }

        // Проверяем участие в диалоге
        const isParticipant = await DialogParticipant.exists({
          dialogId: message.dialogId,
          userId: new mongoose.Types.ObjectId(userId),
          isRemoved: { $ne: true },
        });
        if (!isParticipant) return;

        // Переводим (MongoDB кэш → GPT)
        const result = await translateMessage({
          messageId: String(message._id),
          dialogId: String(message.dialogId),
          text: message.text,
          targetLang,
          requestedBy: userId,
          isPrefetch: false,
        });

        socket.emit("translation:result", {
          messageId: String(message._id),
          translatedText: result.translatedText,
          detectedLang: result.detectedLang,
          targetLang,
          fromDb: result.fromDb,
          sameLanguage: result.sameLanguage || false,
        });
      } catch (err) {
        console.error("translation:request error:", err.message);
        socket.emit("translation:error", {
          messageId,
          error:
            err.message === "RATE_LIMIT"
              ? "Слишком много запросов на перевод"
              : "Ошибка перевода",
        });
      }
    });

    // ======================================================
    // DISCONNECT
    // ======================================================
    socket.on("disconnect", () => {
      console.log("❌ SOCKET DISCONNECTED:", userId);
      nsp.emit("user:offline", { userId });
    });
  });
}

// ======================================================
// HELPER: mark all unread messages in dialog as read
// Обновляет readBy на сообщениях + lastReadAt в participant
// Эмитит message:read всем в room (для обновления галочек у отправителя)
// Эмитит dialog:unreadReset пользователю (для обновления счётчика в sidebar)
// ======================================================
async function _markDialogRead(nsp, dialogId, userId) {
  const dialogObjectId = new mongoose.Types.ObjectId(dialogId);
  const userObjectId = new mongoose.Types.ObjectId(userId);

  // Находим непрочитанные сообщения (от других людей, ещё не прочитанные мной)
  const unread = await ChatMessageModel.find({
    dialogId: dialogObjectId,
    senderId: { $ne: userObjectId },
    isDeleted: { $ne: true },
    "readBy.userId": { $ne: userObjectId },
  }).select("_id");

  const now = new Date();

  // Всегда обновляем lastReadAt — чтобы при перезагрузке счётчик был 0
  await DialogParticipant.updateOne(
    { dialogId: dialogObjectId, userId: userObjectId },
    { $set: { lastReadAt: now } },
  );

  // Всегда сбрасываем счётчик у пользователя в sidebar
  nsp.to(`user:${userId}`).emit("dialog:unreadReset", { dialogId });

  if (!unread.length) return;

  const unreadIds = unread.map((m) => m._id);

  // Добавляем userId в readBy всех непрочитанных
  await ChatMessageModel.updateMany(
    { _id: { $in: unreadIds } },
    { $addToSet: { readBy: { userId: userObjectId, readAt: now } } },
  );

  // Обновляем lastReadMessageId
  await DialogParticipant.updateOne(
    { dialogId: dialogObjectId, userId: userObjectId },
    { $set: { lastReadMessageId: unreadIds[unreadIds.length - 1] } },
  );

  // Уведомляем всю комнату — у отправителя станут двойные галочки
  nsp.to(`room:dialog:${dialogId}`).emit("message:read", {
    dialogId,
    messageIds: unreadIds.map(String),
    readBy: userId,
    readAt: now,
  });
}
