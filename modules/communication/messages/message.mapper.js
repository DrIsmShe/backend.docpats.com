import mongoose from "mongoose";

export function mapAttachmentToDTO(attachment) {
  if (!attachment) return null;
  return {
    id: attachment._id.toString(),
    type: attachment.type,
    url: attachment.url || attachment.fileUrl || null,
    fileUrl: attachment.url || attachment.fileUrl || null,
    mimeType: attachment.mimeType,
    fileSize: attachment.fileSize || attachment.fileSizeBytes || null,
    fileSizeBytes: attachment.fileSizeBytes || attachment.fileSize || null,
    originalName: attachment.originalName,
    durationMs: attachment.durationMs ?? null,
  };
}

// ─── Helper: получить читаемый текст из любого формата сообщения ──────────
// Mongoose document → берём virtual decryptedText
// Plain object (после toObject() или из mongoose.lean()) → читаем поля сами
function extractText(msg) {
  // Если это mongoose document с virtual — он сам решит
  if (typeof msg.decryptedText !== "undefined") {
    return msg.decryptedText;
  }
  // Plain object (из .lean() или после toObject)
  if (msg.textEncrypted) {
    // На lean-объекте virtual не работает — используем safeDecrypt напрямую
    // Импортируем lazy чтобы избежать циклической зависимости через model
    try {
      // eslint-disable-next-line global-require
      const {
        safeDecrypt,
      } = require("../../simulation/services/encryption.service.js");
      return safeDecrypt(msg.textEncrypted, "");
    } catch {
      return "";
    }
  }
  return msg.text ?? null;
}

export function mapMessageToDTO(message) {
  const msg = message.toObject ? message.toObject({ virtuals: true }) : message;

  let replyTo = null;
  if (msg.replyTo) {
    // если populate не сработал и там просто ObjectId/строка
    if (
      typeof msg.replyTo === "string" ||
      msg.replyTo instanceof mongoose.Types.ObjectId
    ) {
      replyTo = {
        id: msg.replyTo.toString(),
        text: null,
        sender: null,
      };
    } else {
      replyTo = {
        id: msg.replyTo._id.toString(),
        text: extractText(msg.replyTo),
        sender: msg.replyTo.senderId
          ? {
              id: msg.replyTo.senderId._id.toString(),
              username: msg.replyTo.senderId.username,
              firstName: msg.replyTo.senderId.firstName,
              lastName: msg.replyTo.senderId.lastName,
              avatar: msg.replyTo.senderId.avatar,
            }
          : null,
      };
    }
  }

  return {
    id: msg._id.toString(),
    dialogId: msg.dialogId.toString(),
    sender: msg.senderId
      ? {
          id: msg.senderId._id.toString(),
          username: msg.senderId.username,
          firstName: msg.senderId.firstName,
          lastName: msg.senderId.lastName,
          avatar: msg.senderId.avatar,
        }
      : null,
    type: msg.type,
    // ⚠️ ВАЖНО: фронт получает дешифрованный текст в обычном поле "text".
    // Поле textEncrypted НИКОГДА не уходит на клиент.
    text: extractText(msg),
    attachments: Array.isArray(msg.attachments)
      ? msg.attachments.filter((a) => !a.isDeleted).map(mapAttachmentToDTO)
      : [],
    replyTo,
    readBy: Array.isArray(msg.readBy)
      ? msg.readBy.map((r) => ({
          userId:
            r.userId?._id?.toString() ??
            r.userId?.toString() ??
            String(r.userId),
          readAt: r.readAt ?? null,
        }))
      : [],
    reactions: Array.isArray(msg.reactions) ? msg.reactions : [],
    createdAt: msg.createdAt,
    editedAt: msg.updatedAt ?? null,
    isDeleted: Boolean(msg.isDeleted),
  };
}
