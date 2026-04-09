// server/modules/communication/messages/message.service.js
import MessageModel from "./message.model.js";
import MessageAttachmentModel from "./messageAttachment.model.js";
import DialogParticipantModel from "../dialogs/dialogParticipant.model.js";
import { mapMessageToDTO } from "./message.mapper.js";
import mongoose from "mongoose";
import DialogModel from "../dialogs/dialog.model.js";
import { prefetchMessageTranslations } from "../chat-translation/messageTranslation.service.js";
import User from "../../../common/models/Auth/users.js";
/**
 * Получить сообщения диалога
 */
export async function getMessagesForDialog({
  userId,
  dialogId,
  before,
  after,
  limit,
}) {
  console.log("💡 getMessagesForDialog", {
    userId,
    dialogId,
    before,
    after,
    limit,
  });
  const dialogObjectId = new mongoose.Types.ObjectId(dialogId);
  const userObjectId = new mongoose.Types.ObjectId(userId);
  // 1. Проверяем, что пользователь участвует в диалоге
  const participant = await DialogParticipantModel.findOne({
    dialogId: dialogObjectId,
    userId: userObjectId,
    isRemoved: { $ne: true },
  });

  console.log("💡 participant in dialog?", !!participant);

  if (!participant) {
    const err = new Error("Forbidden");
    err.status = 403;
    throw err;
  }

  // 2. Фильтр сообщений
  const where = {
    dialogId: dialogObjectId,
    isDeleted: { $ne: true },
  };

  if (before) {
    where.createdAt = { ...(where.createdAt || {}), $lt: new Date(before) };
  }
  if (after) {
    where.createdAt = { ...(where.createdAt || {}), $gt: new Date(after) };
  }

  // 3. Достаём сообщения (новые → старые)
  const messages = await MessageModel.find(where)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("attachments")
    .populate(
      "senderId",
      "username firstNameEncrypted lastNameEncrypted avatar",
    )
    .populate({
      path: "replyTo",
      populate: {
        path: "senderId",
        select: "username firstNameEncrypted lastNameEncrypted avatar",
      },
    });

  const ordered = [...messages].reverse();

  return {
    items: ordered.map((m) => mapMessageToDTO(m)),
    hasMore: messages.length === limit,
  };
}

/**
 * Отправить сообщение (text / file / voice)
 */
export async function sendMessage({
  userId,
  dialogId,
  type,
  text,
  attachments,
  replyToId,
}) {
  const dialogObjectId = new mongoose.Types.ObjectId(dialogId);
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const participant = await DialogParticipantModel.findOne({
    dialogId: dialogObjectId,
    userId: userObjectId,
    isRemoved: { $ne: true },
  });

  if (!participant) {
    const err = new Error("Forbidden");
    err.status = 403;
    throw err;
  }

  // 1️⃣ Создаём сообщение
  let message = await MessageModel.create({
    dialogId,
    senderId: userId,
    type,
    text,
    replyTo: replyToId ? new mongoose.Types.ObjectId(replyToId) : null,
  });

  // 2️⃣ Обновляем диалог
  await DialogModel.findByIdAndUpdate(dialogId, {
    lastMessageId: message._id,
    lastMessageAt: message.createdAt,
    lastMessagePreview: message.text?.slice(0, 100) || null,
  });

  // 3️⃣ Вложения
  let attachmentDocs = [];

  if (attachments && attachments.length) {
    attachmentDocs = await MessageAttachmentModel.insertMany(
      attachments.map((a) => ({
        messageId: message._id,
        type: a.mimeType?.startsWith("audio/") ? "voice" : "file",
        storageKey: a.storageKey || "",
        url: a.url || null,
        mimeType: a.mimeType || null,
        fileSizeBytes: a.fileSizeBytes || null,
        originalName: a.originalName || null,
        durationMs: a.durationMs || null,
      })),
    );
  }

  // 4️⃣ POPULATE отправителя
  message = await message.populate(
    "senderId",
    "username firstName lastName avatar",
  );
  message = await message.populate({
    path: "replyTo",
    populate: {
      path: "senderId",
      select: "username firstName lastName avatar",
    },
  });
  // 5️⃣ Формируем объект
  const messageWithAttachments = {
    ...message.toObject(),
    attachments: attachmentDocs,
  };

  // 6️⃣ Возвращаем DTO
  const dto = mapMessageToDTO(messageWithAttachments);

  // ── Prefetch переводов для участников (fire-and-forget) ──────────────────
  // Запускаем перевод для каждого участника с preferredLanguage сразу после
  // отправки. Когда получатель откроет чат — перевод уже будет в MongoDB.
  if (type === "text" && text?.trim()) {
    (async () => {
      try {
        // Находим всех участников диалога кроме отправителя
        const others = await DialogParticipantModel.find({
          dialogId: dialogObjectId,
          userId: { $ne: userObjectId },
          isRemoved: { $ne: true },
        }).select("userId");

        if (!others.length) return;

        // Берём их preferredLanguage одним запросом
        const users = await User.find({
          _id: { $in: others.map((p) => p.userId) },
          preferredLanguage: { $exists: true, $ne: null },
        }).select("_id preferredLanguage");

        const participantLanguages = users.map((u) => ({
          userId: String(u._id),
          lang: u.preferredLanguage,
        }));

        if (!participantLanguages.length) return;

        prefetchMessageTranslations({
          messageId: String(dto.id),
          dialogId: String(dialogId),
          text,
          participantLanguages,
        });
      } catch (err) {
        console.error("[chatTranslation] prefetch setup error:", err.message);
      }
    })();
  }

  return dto;
}
