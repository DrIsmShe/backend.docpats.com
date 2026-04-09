// server/modules/communication/chat-translation/messageTranslation.routes.js

import { Router } from "express";
import mongoose from "mongoose";
import authMiddleware from "../../../common/middlewares/authvalidateMiddleware/authMiddleware.js";
import DialogParticipant from "../dialogs/dialogParticipant.model.js";
import ChatMessageModel from "../messages/message.model.js";
import {
  translateMessage,
  getMessageTranslations,
  SUPPORTED_LANGUAGES,
} from "./messageTranslation.service.js";

const router = Router();

// Валидация ISO-кода языка (2–8 символов)
function isValidLangCode(code) {
  if (!code || typeof code !== "string") return false;
  return /^[a-z]{2,8}(-[A-Za-z]{2,4})?$/.test(code);
}

// ─── GET /communication/translations/languages ────────────────────────────────
// Список всех поддерживаемых языков (для UI)

router.get("/languages", (_req, res) => {
  res.json({
    languages: Object.entries(SUPPORTED_LANGUAGES).map(([code, name]) => ({
      code,
      name,
    })),
  });
});

// ─── POST /communication/translations/:messageId ──────────────────────────────
// Перевести сообщение. Принимает ЛЮБОЙ валидный ISO-код языка.
// Body: { targetLang: "ja" }

router.post("/:messageId", authMiddleware, async (req, res, next) => {
  try {
    const { messageId } = req.params;
    const { targetLang } = req.body;
    const userId = req.user._id;

    if (!targetLang) {
      return res.status(400).json({ error: "targetLang обязателен" });
    }
    // Принимаем любой ISO-код, не только из списка
    if (!isValidLangCode(targetLang)) {
      return res.status(400).json({
        error: `Неверный код языка: ${targetLang}. Используй формат ISO 639-1 (en, ru, zh-TW, ...)`,
      });
    }
    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ error: "Неверный messageId" });
    }

    const message = await ChatMessageModel.findById(messageId).select(
      "text dialogId isDeleted type",
    );

    if (!message)
      return res.status(404).json({ error: "Сообщение не найдено" });
    if (message.isDeleted)
      return res.status(410).json({ error: "Сообщение удалено" });
    if (message.type !== "text" || !message.text) {
      return res
        .status(400)
        .json({ error: "Перевод доступен только для текстовых сообщений" });
    }

    const isParticipant = await DialogParticipant.exists({
      dialogId: message.dialogId,
      userId: new mongoose.Types.ObjectId(userId),
      isRemoved: { $ne: true },
    });
    if (!isParticipant) return res.status(403).json({ error: "Forbidden" });

    const result = await translateMessage({
      messageId: String(message._id),
      dialogId: String(message.dialogId),
      text: message.text,
      targetLang,
      requestedBy: String(userId),
      isPrefetch: false,
    });

    return res.json({
      messageId: String(message._id),
      originalText: message.text,
      translatedText: result.translatedText,
      detectedLang: result.detectedLang,
      targetLang,
      fromDb: result.fromDb,
      sameLanguage: result.sameLanguage || false,
    });
  } catch (err) {
    if (err.message === "RATE_LIMIT") {
      return res
        .status(429)
        .json({ error: "Слишком много запросов. Подождите минуту." });
    }
    next(err);
  }
});

// ─── GET /communication/translations/:messageId/all ───────────────────────────

router.get("/:messageId/all", authMiddleware, async (req, res, next) => {
  try {
    const { messageId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ error: "Неверный messageId" });
    }

    const message =
      await ChatMessageModel.findById(messageId).select("dialogId isDeleted");
    if (!message || message.isDeleted)
      return res.status(404).json({ error: "Не найдено" });

    const isParticipant = await DialogParticipant.exists({
      dialogId: message.dialogId,
      userId: new mongoose.Types.ObjectId(userId),
      isRemoved: { $ne: true },
    });
    if (!isParticipant) return res.status(403).json({ error: "Forbidden" });

    const translations = await getMessageTranslations(messageId);
    res.json({ messageId, translations });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /communication/translations/preferences ─────────────────────────────
// Сохранить предпочитаемый язык пользователя
// Body: { lang: "ja" } — любой ISO-код

router.put("/preferences", authMiddleware, async (req, res, next) => {
  try {
    const { lang } = req.body;
    const userId = req.user._id;

    if (!isValidLangCode(lang)) {
      return res.status(400).json({
        error:
          "Неверный код языка. Используй формат ISO 639-1 (en, ru, ja, zh-TW, ...)",
      });
    }

    const User = (await import("../../../common/models/Auth/users.js")).default;
    await User.findByIdAndUpdate(userId, { $set: { preferredLanguage: lang } });

    res.json({ success: true, lang });
  } catch (err) {
    next(err);
  }
});

export default router;
