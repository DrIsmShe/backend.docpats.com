// server/modules/communication/messages/message.service.js
import MessageModel, { encryptMessageText } from "./message.model.js";
import MessageAttachmentModel from "./messageAttachment.model.js";
import DialogParticipantModel from "../dialogs/dialogParticipant.model.js";
import { mapMessageToDTO } from "./message.mapper.js";
import mongoose from "mongoose";
import DialogModel from "../dialogs/dialog.model.js";
import { prefetchMessageTranslations } from "../chat-translation/messageTranslation.service.js";
import User from "../../../common/models/Auth/users.js";

/**
 * Получить сообщения диалога
 *
 * Шифрование: messages в БД могут лежать в двух форматах:
 *   - Legacy: text (plain) ← старые записи до миграции
 *   - Зашифрованные: textEncrypted ← все новые + старые после migrate-скрипта
 *
 * Mapper автоматически выбирает правильный формат через virtual decryptedText.
 * Фронту всегда возвращается DTO с обычным полем `text` (дешифрованным).
 */
export async function getMessagesForDialog({
  userId,
  dialogId,
  before,
  after,
  limit,
}) {
  const dialogObjectId = new mongoose.Types.ObjectId(dialogId);
  const userObjectId = new mongoose.Types.ObjectId(userId);
  // 1. Проверяем, что пользователь участвует в диалоге
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
  // ВАЖНО: НЕ используем .lean() — virtual decryptedText работает только
  // на полноценных mongoose document'ах. Если когда-то понадобится lean,
  // заменим на ручной safeDecrypt в mapper (он уже умеет оба варианта).
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
 *
 * Шифрование текста — HIPAA § 164.312(a)(2)(iv). Plain text НИКОГДА
 * не сохраняется в БД для новых сообщений. Только textEncrypted.
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

  // ── Шифруем текст ДО создания записи в БД ────────────────────────────
  // encryptMessageText вернёт null для пустых сообщений (file-only/voice).
  // Поле text НЕ записываем — только textEncrypted.
  const textEncrypted = encryptMessageText(text);

  // 1️⃣ Создаём сообщение
  let message = await MessageModel.create({
    dialogId,
    senderId: userId,
    type,
    textEncrypted, // ← зашифрованный текст
    // text НЕ передаём — он остаётся undefined для новых сообщений
    replyTo: replyToId ? new mongoose.Types.ObjectId(replyToId) : null,
  });

  // 2️⃣ Обновляем диалог
  // Превью последнего сообщения — тоже PHI (первые ~100 символов текста).
  // Шифруем его тем же ключом (HIPAA at-rest) и НЕ пишем plaintext.
  // Для file/voice-сообщений text пустой → encryptMessageText вернёт null.
  await DialogModel.findByIdAndUpdate(dialogId, {
    lastMessageId: message._id,
    lastMessageAt: message.createdAt,
    lastMessagePreviewEncrypted: encryptMessageText(
      text ? String(text).slice(0, 100) : null,
    ),
    lastMessagePreview: null, // очищаем legacy plaintext, если он был
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

  // 5️⃣ Формируем объект для mapper
  // Используем toObject() с virtuals — virtual decryptedText сам разшифрует
  // textEncrypted в text для DTO.
  const messageWithAttachments = {
    ...message.toObject({ virtuals: true }),
    attachments: attachmentDocs,
  };

  // 6️⃣ Возвращаем DTO (там text уже дешифрованный)
  const dto = mapMessageToDTO(messageWithAttachments);

  // ── Prefetch переводов для участников (fire-and-forget) ──────────────────
  // Используем оригинальный text (не зашифрованный) — он есть в памяти.
  // Translation service шифрует свой кэш сам (originalTextEncrypted /
  // translatedTextEncrypted).
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
