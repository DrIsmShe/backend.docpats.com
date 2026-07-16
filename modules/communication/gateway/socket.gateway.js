// server/modules/communication/gateway/socket.gateway.js
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
import { createSocketRateLimiter } from "../../../common/utils/socketRateLimit.js";
import { recordActionAsync } from "../../audit/index.js";
import User from "../../../common/models/Auth/users.js";

let ioInstance = null;
let presenceSweepTimer = null;

/**
 * Presence в БД. Список пользователей (getUsersListController) считает статус
 * по User.lastActive: свежее 2 мин → online, 2–15 мин → away, дальше → offline.
 * Поэтому пока жив сокет, lastActive нужно периодически освежать.
 * «invisible» не раскрываем — обновляем только активность, статус не трогаем.
 */
async function setUserPresence(userId, online) {
  try {
    await User.updateOne(
      { _id: userId, status: { $ne: "invisible" } },
      { $set: { status: online ? "online" : "offline", lastActive: new Date() } },
    );
    await User.updateOne(
      { _id: userId, status: "invisible" },
      { $set: { lastActive: new Date() } },
    );
  } catch (e) {
    console.warn("[presence] update failed:", e.message);
  }
}

/**
 * Периодически освежает lastActive всех подключённых пользователей.
 * userId берём из персональных комнат "user:<id>" — fetchSockets() не
 * сохраняет socket.user, а комнаты доступны в адаптере.
 */
async function presenceSweep(nsp) {
  try {
    const ids = [];
    for (const room of nsp.adapter.rooms.keys()) {
      if (room.startsWith("user:")) ids.push(room.slice(5));
    }
    if (!ids.length) return;
    await User.updateMany(
      { _id: { $in: ids }, status: { $ne: "invisible" } },
      { $set: { status: "online", lastActive: new Date() } },
    );
    await User.updateMany(
      { _id: { $in: ids }, status: "invisible" },
      { $set: { lastActive: new Date() } },
    );
  } catch (e) {
    console.warn("[presence] sweep failed:", e.message);
  }
}

// ─── Rate limiters per event type ─────────────────────────────────────
// Каждое событие имеет свой счётчик независимый от других.
// При превышении лимита: 60с → 5мин → 15мин → 1ч (прогрессивно)
const messageSendLimiter = createSocketRateLimiter("message:send", {
  max: 30,
  windowMs: 60_000, // 30 сообщений в минуту
});

const messageReactLimiter = createSocketRateLimiter("message:react", {
  max: 60,
  windowMs: 60_000, // 60 реакций в минуту
});

const typingLimiter = createSocketRateLimiter("typing:start", {
  max: 20,
  windowMs: 60_000, // 20 typing-стартов в минуту
});

const dialogJoinLimiter = createSocketRateLimiter("dialog:join", {
  max: 30,
  windowMs: 60_000, // 30 заходов в диалог в минуту
});

// ─── Audit context helper ─────────────────────────────────────────────
// Возвращает ФОРМУ, которую ждёт auditService.recordAction:
//   { actor: { userId, email, role }, context: { ipAddress, userAgent, sessionId } }
//
// ⚠️ КРИТИЧНО: раньше возвращался плоский объект (userId/actorEmail/... на
// верхнем уровне). recordAction читает params.actor.userId — при плоской
// форме actor === undefined, срабатывал throw "actor.userId is required",
// recordActionAsync глотал ошибку → НИ ОДНА socket-запись аудита не
// сохранялась. Теперь форма вложенная — аудит из WebSocket реально пишется.
function _auditContext(socket) {
  const session = socket.request?.session || {};
  return {
    actor: {
      userId: socket.user?.id,
      email: session.email || null,
      role: session.role || null,
    },
    context: {
      sessionId: socket.request?.sessionID || null,
      ipAddress:
        socket.handshake?.address ||
        socket.request?.connection?.remoteAddress ||
        null,
      userAgent: socket.handshake?.headers?.["user-agent"] || null,
    },
  };
}

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

  // Держим presence живым, пока есть подключённые сокеты (каждые 60с).
  if (presenceSweepTimer) clearInterval(presenceSweepTimer);
  presenceSweepTimer = setInterval(() => presenceSweep(nsp), 60_000);

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
    // Отмечаем online в БД сразу, не дожидаясь ближайшего sweep.
    setUserPresence(userId, true);

    // ======================================================
    // JOIN DIALOG
    // ======================================================
    socket.on("dialog:join", async ({ dialogId }) => {
      try {
        if (!dialogId) return;

        // ── Rate limit: 30/min ──
        if (!dialogJoinLimiter.check(socket, userId)) return;

        const dialogObjectId = new mongoose.Types.ObjectId(dialogId);
        const userObjectId = new mongoose.Types.ObjectId(userId);

        const isParticipant = await DialogParticipant.exists({
          dialogId: dialogObjectId,
          userId: userObjectId,
          isRemoved: { $ne: true },
        });

        if (!isParticipant) {
          console.log("❌ NOT PARTICIPANT:", userId, dialogId);

          // ✅ AUDIT — denied access (важно для security аналитики)
          recordActionAsync({
            ..._auditContext(socket),
            action: "chat.dialog.join",
            resourceType: "chat-dialog",
            resourceId: dialogId,
            outcome: "denied",
            failureReason: "not_a_participant",
            metadata: { via: "websocket" },
          });
          return;
        }

        socket.join(`room:dialog:${dialogId}`);
        console.log("✅ JOIN:", dialogId);

        // ✅ AUDIT — join success
        recordActionAsync({
          ..._auditContext(socket),
          action: "chat.dialog.join",
          resourceType: "chat-dialog",
          resourceId: dialogId,
          outcome: "success",
          metadata: { via: "websocket" },
        });

        // ✅ FIX: При входе в диалог — отмечаем все сообщения как прочитанные
        await _markDialogRead(nsp, dialogId, userId);
      } catch (error) {
        console.error("dialog:join error:", error);

        // ✅ AUDIT — failure
        recordActionAsync({
          ..._auditContext(socket),
          action: "chat.dialog.join",
          resourceType: "chat-dialog",
          resourceId: dialogId,
          outcome: "failure",
          failureReason: error.message,
          metadata: { via: "websocket" },
        });
      }
    });

    // ======================================================
    // LEAVE DIALOG (без лимита — служебное событие)
    // ======================================================
    socket.on("dialog:leave", ({ dialogId }) => {
      if (!dialogId) return;
      socket.leave(`room:dialog:${dialogId}`);
      console.log("🚪 LEFT:", dialogId);
    });

    // ======================================================
    // MARK DIALOG READ (без лимита — служебное событие)
    // ======================================================
    socket.on("dialog:markRead", async ({ dialogId }) => {
      try {
        if (!dialogId) return;
        await _markDialogRead(nsp, dialogId, userId);

        // ✅ AUDIT — mark read success
        recordActionAsync({
          ..._auditContext(socket),
          action: "chat.dialog.mark_read",
          resourceType: "chat-dialog",
          resourceId: dialogId,
          outcome: "success",
          metadata: { via: "websocket" },
        });
      } catch (error) {
        console.error("dialog:markRead error:", error);

        recordActionAsync({
          ..._auditContext(socket),
          action: "chat.dialog.mark_read",
          resourceType: "chat-dialog",
          resourceId: dialogId,
          outcome: "failure",
          failureReason: error.message,
          metadata: { via: "websocket" },
        });
      }
    });

    // ======================================================
    // SEND MESSAGE
    // ======================================================
    socket.on("message:send", async (payload = {}) => {
      const { tempId, dialogId, type, text, attachments } = payload;

      try {
        if (!dialogId) return;

        // ── Rate limit: 30/min ──
        // Дублирует HTTP rate limit (тот защищает /messages POST,
        // этот защищает прямой вызов через WebSocket).
        if (!messageSendLimiter.check(socket, userId)) {
          // ✅ AUDIT — rate limited (важно для security)
          recordActionAsync({
            ..._auditContext(socket),
            action: "chat.message.create",
            resourceType: "chat-message",
            resourceId: dialogId,
            outcome: "denied",
            failureReason: "rate_limit_exceeded",
            metadata: { via: "websocket" },
          });
          return;
        }

        console.log("MESSAGE SEND:", payload);

        const peerId = await getPeerIdInDialog(dialogId, userId);
        const { blocked, reason } = await checkBlockBetween(userId, peerId);
        if (blocked) {
          socket.emit("message:blocked", { dialogId, reason });

          // ✅ AUDIT — blocked
          recordActionAsync({
            ..._auditContext(socket),
            action: "chat.message.create",
            resourceType: "chat-message",
            resourceId: dialogId,
            resourceOwnerId: peerId ? String(peerId) : null,
            outcome: "denied",
            failureReason: `blocked: ${reason || "unknown"}`,
            metadata: { via: "websocket" },
          });
          return;
        }

        const message = await messageService.sendMessage({
          userId,
          dialogId,
          type,
          text,
          attachments,
        });

        // ✅ AUDIT — message created
        // ВАЖНО: НЕ записываем сам text — это PHI. Только статистику.
        recordActionAsync({
          ..._auditContext(socket),
          action: "chat.message.create",
          resourceType: "chat-message",
          resourceId: message?.id ? String(message.id) : dialogId,
          resourceOwnerId: peerId ? String(peerId) : null,
          outcome: "success",
          metadata: {
            via: "websocket",
            dialogId,
            type: type || "text",
            textLength: typeof text === "string" ? text.length : 0,
            attachmentsCount: Array.isArray(attachments)
              ? attachments.length
              : 0,
          },
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

        // ✅ AUDIT — failure
        recordActionAsync({
          ..._auditContext(socket),
          action: "chat.message.create",
          resourceType: "chat-message",
          resourceId: dialogId,
          outcome: "failure",
          failureReason: error.message,
          metadata: { via: "websocket" },
        });
      }
    });

    // ======================================================
    // DELETE MESSAGE (без лимита — редкое действие)
    // ======================================================
    socket.on("message:delete", async ({ messageId }) => {
      console.log("🗑 DELETE REQUEST:", messageId, "from", userId);
      try {
        if (!messageId) return;

        const message = await ChatMessageModel.findById(messageId);
        if (!message) return;

        if (String(message.senderId) !== String(userId)) {
          // ✅ AUDIT — denied (попытка удалить чужое сообщение!)
          recordActionAsync({
            ..._auditContext(socket),
            action: "chat.message.delete",
            resourceType: "chat-message",
            resourceId: messageId,
            outcome: "denied",
            failureReason: "not_message_owner",
            metadata: { via: "websocket" },
          });
          return;
        }

        const DELETE_TIME_LIMIT_MS = 10 * 60 * 1000;
        const messageAge = Date.now() - new Date(message.createdAt).getTime();
        if (messageAge > DELETE_TIME_LIMIT_MS) {
          // ✅ AUDIT — denied (попытка удалить сообщение старше 10 мин)
          recordActionAsync({
            ..._auditContext(socket),
            action: "chat.message.delete",
            resourceType: "chat-message",
            resourceId: messageId,
            outcome: "denied",
            failureReason: "time_limit_exceeded",
            metadata: {
              via: "websocket",
              messageAgeSec: Math.round(messageAge / 1000),
            },
          });
          return;
        }

        message.isDeleted = true;
        message.deletedAt = new Date();
        message.deletedBy = userId;
        // Чистим и legacy plaintext, и зашифрованный текст — иначе PHI
        // удалённого сообщения остаётся в БД в textEncrypted.
        message.text = "";
        message.textEncrypted = null;
        message.reactions = [];

        await message.save();

        // ✅ AUDIT — delete success
        recordActionAsync({
          ..._auditContext(socket),
          action: "chat.message.delete",
          resourceType: "chat-message",
          resourceId: messageId,
          outcome: "success",
          metadata: {
            via: "websocket",
            dialogId: String(message.dialogId),
          },
        });

        nsp.to(`room:dialog:${message.dialogId}`).emit("message:deleted", {
          dialogId: message.dialogId,
          messageId,
        });
      } catch (error) {
        console.error("message:delete error:", error);

        recordActionAsync({
          ..._auditContext(socket),
          action: "chat.message.delete",
          resourceType: "chat-message",
          resourceId: messageId,
          outcome: "failure",
          failureReason: error.message,
          metadata: { via: "websocket" },
        });
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

          // ── Rate limit: 60/min ──
          if (!messageReactLimiter.check(socket, userId)) return;

          const isParticipant = await DialogParticipant.exists({
            dialogId: new mongoose.Types.ObjectId(dialogId),
            userId: new mongoose.Types.ObjectId(userId),
            isRemoved: { $ne: true },
          });
          if (!isParticipant) {
            // ✅ AUDIT — denied (попытка реакции в чужом диалоге)
            recordActionAsync({
              ..._auditContext(socket),
              action: "chat.message.react",
              resourceType: "chat-message",
              resourceId: messageId,
              outcome: "denied",
              failureReason: "not_a_participant",
              metadata: { via: "websocket", dialogId },
            });
            return;
          }

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

          // ✅ AUDIT — react success
          // metadata: только action и наличие emoji (НЕ сам emoji — он может
          // быть неуместным/спорным контентом, лучше хранить только факт)
          recordActionAsync({
            ..._auditContext(socket),
            action: "chat.message.react",
            resourceType: "chat-message",
            resourceId: messageId,
            outcome: "success",
            metadata: {
              via: "websocket",
              dialogId,
              reactionAction: action || "add",
            },
          });

          nsp.to(`room:dialog:${dialogId}`).emit("message:reaction", {
            messageId,
            emoji,
            userId,
            action,
          });
        } catch (error) {
          console.error("message:react error:", error);

          recordActionAsync({
            ..._auditContext(socket),
            action: "chat.message.react",
            resourceType: "chat-message",
            resourceId: messageId,
            outcome: "failure",
            failureReason: error.message,
            metadata: { via: "websocket" },
          });
        }
      },
    );

    // ======================================================
    // TYPING EVENTS (без audit — ephemeral, не PHI)
    // ======================================================
    socket.on("typing:start", ({ dialogId }) => {
      if (!dialogId) return;
      // ── Rate limit: 20/min ──
      // typing:stop не лимитим — он может прилететь вне зависимости.
      if (!typingLimiter.check(socket, userId)) return;
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

    // ======================================================
    // TRANSLATION REQUEST (свой rate limit уже в translateMessage)
    // ======================================================
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

        // Загружаем сообщение.
        // ВАЖНО: тянем textEncrypted и используем virtual decryptedText —
        // после шифрования (#1) поле text у новых сообщений пустое, весь
        // текст лежит в textEncrypted. Без этого перевод новых сообщений
        // всегда падал в "недоступно для перевода".
        const message = await ChatMessageModel.findById(messageId).select(
          "text textEncrypted dialogId isDeleted type",
        );

        const plainText = message?.decryptedText;

        if (
          !message ||
          message.isDeleted ||
          message.type !== "text" ||
          !plainText
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
        if (!isParticipant) {
          // ✅ AUDIT — denied (перевод в чужом диалоге)
          recordActionAsync({
            ..._auditContext(socket),
            action: "chat.message.translate",
            resourceType: "chat-message",
            resourceId: messageId,
            outcome: "denied",
            failureReason: "not_a_participant",
            metadata: {
              via: "websocket",
              dialogId: String(message.dialogId),
              targetLang,
            },
          });
          return;
        }

        // Переводим (MongoDB кэш → GPT). Передаём ДЕШИФРОВАННЫЙ текст.
        const result = await translateMessage({
          messageId: String(message._id),
          dialogId: String(message.dialogId),
          text: plainText,
          targetLang,
          requestedBy: userId,
          isPrefetch: false,
        });

        // ✅ AUDIT — перевод = доступ к PHI сообщения, логируем.
        recordActionAsync({
          ..._auditContext(socket),
          action: "chat.message.translate",
          resourceType: "chat-message",
          resourceId: messageId,
          outcome: "success",
          metadata: {
            via: "websocket",
            dialogId: String(message.dialogId),
            targetLang,
            fromDb: Boolean(result.fromDb),
          },
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

        recordActionAsync({
          ..._auditContext(socket),
          action: "chat.message.translate",
          resourceType: "chat-message",
          resourceId: messageId,
          outcome: "failure",
          failureReason: err.message,
          metadata: { via: "websocket", targetLang },
        });

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
    socket.on("disconnect", async () => {
      console.log("❌ SOCKET DISCONNECTED:", userId);
      nsp.emit("user:offline", { userId });
      // Offline только если у пользователя не осталось других вкладок/сокетов.
      try {
        const remaining = await nsp.in(`user:${userId}`).fetchSockets();
        if (remaining.length === 0) {
          await setUserPresence(userId, false);
        }
      } catch (e) {
        console.warn("[presence] disconnect update failed:", e.message);
      }
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
