import { Router } from "express";
import * as messageService from "./message.service.js";
import authMiddleware from "../../../common/middlewares/authvalidateMiddleware/authMiddleware.js";
import DialogParticipant from "../dialogs/dialogParticipant.model.js";
import Notification from "../../../common/models/Notification/notification.js";
import ChatMessageModel from "../messages/message.model.js";
import mongoose from "mongoose";
import {
  upload,
  uploadFile,
} from "../../../common/middlewares/uploadMiddleware.js";

// ─── Rate limiter: 30 сообщений в минуту на пользователя ───────────────────
// Хранилище: { userId → { timestamps, blockedUntil, violations } }
const httpRateStore = new Map();

function httpRateLimit(req, res, next) {
  const userId = String(req.user?._id || req.user?.id || req.ip);
  console.log(
    `[HTTP-RL] userId=${userId} timestamps=${httpRateStore.get(userId)?.timestamps?.length ?? 0} blocked=${httpRateStore.get(userId)?.blockedUntil ?? 0 > Date.now()}`,
  );
  const now = Date.now();

  if (!httpRateStore.has(userId)) {
    httpRateStore.set(userId, {
      timestamps: [],
      blockedUntil: 0,
      violations: 0,
    });
  }
  const state = httpRateStore.get(userId);

  if (now < state.blockedUntil) {
    const secsLeft = Math.ceil((state.blockedUntil - now) / 1000);
    return res.status(429).json({
      error: `Слишком много сообщений. Подождите ещё ${secsLeft} сек.`,
    });
  }

  state.timestamps = state.timestamps.filter((t) => now - t < 60_000);

  if (state.timestamps.length >= 30) {
    state.violations++;
    const penalties = [60, 300, 900, 3600];
    const penaltySec =
      penalties[Math.min(state.violations - 1, penalties.length - 1)];
    state.blockedUntil = now + penaltySec * 1000;
    const label =
      penaltySec >= 60
        ? `${Math.round(penaltySec / 60)} мин.`
        : `${penaltySec} сек.`;
    console.warn(
      `🚫 HTTP RateLimit userId=${userId} violation #${state.violations}, blocked ${label}`,
    );
    return res.status(429).json({
      error: `Превышен лимит сообщений. Заблокировано на ${label}`,
    });
  }

  state.timestamps.push(now);
  next();
}

const router = Router();

// ✅ получить сообщения конкретного диалога
router.get("/dialog/:dialogId", authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { dialogId } = req.params;
    const { before, after, limit } = req.query;

    const result = await messageService.getMessagesForDialog({
      userId,
      dialogId,
      before,
      after,
      limit: Number(limit) || 30,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ✅ отправить сообщение
router.post("/", authMiddleware, httpRateLimit, async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { dialogId, roomId, type, text, attachments, replyToId } = req.body;

    const finalDialogId = dialogId || roomId;

    if (!finalDialogId) {
      return res.status(400).json({ error: "dialogId required" });
    }

    // ─── Валидация типа сообщения ────────────────────────────────────────────
    const ALLOWED_TYPES = ["text", "image", "file", "voice", "video"];
    const msgType = type || "text";
    if (!ALLOWED_TYPES.includes(msgType)) {
      return res
        .status(400)
        .json({ error: `Недопустимый тип сообщения: ${msgType}` });
    }

    // ─── Валидация текста ────────────────────────────────────────────────────
    const trimmedText = typeof text === "string" ? text.trim() : "";

    if (msgType === "text") {
      if (!trimmedText && (!attachments || attachments.length === 0)) {
        return res
          .status(400)
          .json({ error: "Сообщение не может быть пустым" });
      }
      if (trimmedText.length > 5000) {
        return res.status(400).json({
          error: "Сообщение слишком длинное (максимум 5000 символов)",
        });
      }
    }

    // ─── Валидация вложений ──────────────────────────────────────────────────
    if (attachments && !Array.isArray(attachments)) {
      return res
        .status(400)
        .json({ error: "attachments должен быть массивом" });
    }
    if (attachments && attachments.length > 10) {
      return res.status(400).json({ error: "Максимум 10 вложений за раз" });
    }

    const message = await messageService.sendMessage({
      userId,
      dialogId: finalDialogId,
      type,
      text,
      attachments,
      replyToId, // ✅ теперь reply сохраняется
    });

    const io = req.app.get("io");
    const nsp = io?.of("/communication");

    if (nsp) {
      console.log("📡 EMIT TO ROOM:", finalDialogId);
      nsp.to(`room:dialog:${finalDialogId}`).emit("message:new", {
        dialogId: finalDialogId,
        tempId: null,
        message,
      });

      // ── Notify each recipient: unread badge + bell ──────────────────────
      try {
        const participants = await DialogParticipant.find({
          dialogId: new mongoose.Types.ObjectId(finalDialogId),
          userId: { $ne: new mongoose.Types.ObjectId(userId) },
          isRemoved: { $ne: true },
        }).select("userId lastReadAt");

        for (const p of participants) {
          const recipientId = p.userId.toString();

          // 1. Unread count badge in DialogList
          const unreadCount = await ChatMessageModel.countDocuments({
            dialogId: new mongoose.Types.ObjectId(finalDialogId),
            senderId: { $ne: p.userId },
            ...(p.lastReadAt ? { createdAt: { $gt: p.lastReadAt } } : {}),
            isDeleted: { $ne: true },
          });
          nsp.to(`user:${recipientId}`).emit("dialog:unread", {
            dialogId: finalDialogId,
            unreadCount,
          });

          // 2. Notification bell
          const senderName =
            message.sender?.firstName ||
            message.sender?.username ||
            "Новое сообщение";
          const preview =
            message.text || (message.attachments?.length ? "📎 Файл" : "...");

          // 2. Save to DB — guaranteed delivery even if user is offline
          const savedNotification = await Notification.create({
            userId: recipientId,
            senderId: userId,
            type: "chat_message",
            title: senderName,
            message: preview,
            link: `/doctor/communication/${finalDialogId}`,
            isRead: false,
            meta: { dialogId: finalDialogId },
          });

          const notificationPayload = {
            _id: savedNotification._id,
            type: "chat_message",
            title: senderName,
            message: preview,
            link: `/doctor/communication/${finalDialogId}`,
            dialogId: finalDialogId,
            isRead: false,
            createdAt: savedNotification.createdAt,
          };

          // Realtime via /communication personal room
          nsp
            .to(`user:${recipientId}`)
            .emit("new_notification", notificationPayload);

          // Realtime via global.io main namespace (same as eventBus)
          if (global.io) {
            global.io
              .to(recipientId)
              .emit("new_notification", notificationPayload);
          }
          console.log(
            `🔔 SAVED + EMITTED new_notification → user:${recipientId}`,
          );
        }
      } catch (notifyErr) {
        console.error("notify error:", notifyErr);
      }
    }

    res.status(201).json(message);
  } catch (err) {
    next(err);
  }
});
// ✅ загрузка файла для чата
router.post(
  "/upload",
  authMiddleware,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Файл не передан" });
      }

      const fileUrl = await uploadFile(req.file);
      const mimeCategory = req.file.mimetype.split("/")[0];
      const fileType = ["image", "video", "audio"].includes(mimeCategory)
        ? mimeCategory
        : "file";

      return res.json({
        fileUrl,
        url: fileUrl,
        fileName: req.file.originalname,
        originalName: req.file.originalname,
        fileSize: req.file.size,
        fileSizeBytes: req.file.size,
        fileFormat: req.file.mimetype,
        mimeType: req.file.mimetype,
        fileType,
        storageKey: "",
      });
    } catch (err) {
      console.error("Chat upload error:", err);
      return res
        .status(500)
        .json({ error: err.message || "Ошибка загрузки файла" });
    }
  },
);

export default router;
