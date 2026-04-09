import { Router } from "express";
import * as dialogService from "./dialog.service.js";
import authMiddleware from "../../../common/middlewares/authvalidateMiddleware/authMiddleware.js";

const router = Router();

// --- создать диалог ---
router.post("/", authMiddleware, async (req, res, next) => {
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
});

// --- список диалогов ---
router.get("/", authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user._id;
    const result = await dialogService.getDialogsForUser(userId);
    res.json({ dialogs: result });
  } catch (err) {
    next(err);
  }
});

router.get("/search", authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user._id;
    const q = (req.query.q || "").trim();

    if (!q || q.length < 2) {
      return res.json({ dialogs: [], messages: [] });
    }

    const results = await dialogService.searchDialogsAndMessages({ userId, q });
    res.json(results);
  } catch (err) {
    next(err);
  }
});

// --- получить диалог ---
router.get("/:dialogId", authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { dialogId } = req.params;

    const dialog = await dialogService.getDialogById({ userId, dialogId });
    res.json(dialog);
  } catch (err) {
    next(err);
  }
});

// --- отметить прочитанным ---
router.post("/:dialogId/read", authMiddleware, async (req, res, next) => {
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
});

// 🔥 ВАЖНО: приватный диалог с пользователем
router.post("/with-user", authMiddleware, async (req, res, next) => {
  try {
    console.log("➡️ POST /communication/dialogs/with-user BODY:", req.body);
    console.log("👤 currentUserId:", req.user._id);

    const currentUserId = req.user._id;
    const { peerUserId } = req.body;

    if (!peerUserId) {
      return res.status(400).json({ message: "peerUserId обязателен" });
    }

    const dialog = await dialogService.getOrCreatePrivateDialog({
      currentUserId,
      peerUserId,
    });

    console.log("✅ dialog created/found:", dialog._id.toString());

    res.json({ dialog });
  } catch (err) {
    console.error("❌ getOrCreatePrivateDialog error:", err);
    next(err);
  }
});

export default router;
