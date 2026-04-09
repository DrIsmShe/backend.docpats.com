// server/src/communication/block/block.routes.js

import { Router } from "express";
import authMiddleware from "../../../common/middlewares/authvalidateMiddleware/authMiddleware.js";
import { getBlockStatus, blockUser, unblockUser } from "./block.controller.js";

const router = Router();

// GET  /communication/block/status/:peerId  — проверить статус блокировки
router.get("/status/:peerId", authMiddleware, getBlockStatus);

// POST /communication/block/:peerId         — заблокировать
router.post("/:peerId", authMiddleware, blockUser);

// DELETE /communication/block/:peerId       — разблокировать
router.delete("/:peerId", authMiddleware, unblockUser);

export default router;
