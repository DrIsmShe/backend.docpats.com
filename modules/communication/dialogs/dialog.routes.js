import { Router } from "express";
import * as dialogService from "./dialog.service.js";
import authMiddleware from "../../../common/middlewares/authvalidateMiddleware/authMiddleware.js";
import auditMiddleware from "../../audit/middleware/auditMiddleware.js";

const router = Router();

// --- создать диалог ---
router.post(
  "/",
  authMiddleware,
  auditMiddleware({
    resourceType: "chat-dialog",
    action: "chat.dialog.create",
    metaFrom: (req) => ({
      type: req.body?.type,
      participantsCount: Array.isArray(req.body?.participantIds)
        ? req.body.participantIds.length
        : 0,
    }),
  }),
  async (req, res, next) => {
    try {
      const userId = req.user._id;
      const { participantIds, type } = req.body;

      const dialog = await dialogService.createDialog({
        creatorId: userId,
        participantIds,
        type,
      });

      res.status(201).json(dialog);
    } catch (err) {
      next(err);
    }
  },
);

// --- список диалогов ---
router.get(
  "/",
  authMiddleware,
  auditMiddleware({
    resourceType: "chat-dialog",
    action: "chat.dialog.list",
  }),
  async (req, res, next) => {
    try {
      const userId = req.user._id;
      const result = await dialogService.getDialogsForUser(userId);
      res.json({ dialogs: result });
    } catch (err) {
      next(err);
    }
  },
);

// --- поиск по диалогам и сообщениям ---
router.get(
  "/search",
  authMiddleware,
  auditMiddleware({
    resourceType: "chat-dialog",
    action: "chat.dialog.search",
    // ВАЖНО: НЕ записываем сам поисковый запрос — он может содержать
    // PHI (имя пациента, диагноз). Только статистику.
    metaFrom: (req) => ({
      queryLength: (req.query?.q || "").length,
    }),
  }),
  async (req, res, next) => {
    try {
      const userId = req.user._id;
      const q = (req.query.q || "").trim();

      if (!q || q.length < 2) {
        return res.json({ dialogs: [], messages: [] });
      }

      const results = await dialogService.searchDialogsAndMessages({
        userId,
        q,
      });
      res.json(results);
    } catch (err) {
      next(err);
    }
  },
);

// --- получить диалог ---
router.get(
  "/:dialogId",
  authMiddleware,
  auditMiddleware({
    resourceType: "chat-dialog",
    action: "chat.dialog.read",
    resourceIdFrom: "params.dialogId",
  }),
  async (req, res, next) => {
    try {
      const userId = req.user._id;
      const { dialogId } = req.params;

      const dialog = await dialogService.getDialogById({ userId, dialogId });
      res.json(dialog);
    } catch (err) {
      next(err);
    }
  },
);

// --- отметить прочитанным ---
router.post(
  "/:dialogId/read",
  authMiddleware,
  auditMiddleware({
    resourceType: "chat-dialog",
    action: "chat.dialog.mark_read",
    resourceIdFrom: "params.dialogId",
  }),
  async (req, res, next) => {
    try {
      const userId = req.user._id;
      const { dialogId } = req.params;
      const { lastReadMessageId } = req.body;

      await dialogService.markDialogRead({
        userId,
        dialogId,
        lastReadMessageId,
      });

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// 🔥 ВАЖНО: приватный диалог с пользователем
router.post(
  "/with-user",
  authMiddleware,
  auditMiddleware({
    resourceType: "chat-dialog",
    action: "chat.dialog.create_private",
    // peerUserId — это owner ресурса (с кем создаём диалог).
    // Позволяет пациенту через GET /audit/owners/:userId увидеть
    // кто инициировал с ним приватный чат.
    resourceOwnerIdFrom: "body.peerUserId",
  }),
  async (req, res, next) => {
    try {
      const currentUserId = req.user._id;
      const { peerUserId } = req.body;

      if (!peerUserId) {
        return res.status(400).json({ message: "peerUserId обязателен" });
      }

      const dialog = await dialogService.getOrCreatePrivateDialog({
        currentUserId,
        peerUserId,
      });

      res.json({ dialog });
    } catch (err) {
      console.error("❌ getOrCreatePrivateDialog error:", err);
      next(err);
    }
  },
);

export default router;
