// server/modules/communication/video/video.routes.js
//
// Routes for Jitsi video integration. Currently a single endpoint that
// hands out a room-access token after session-based authorization.
//
// Protected by the same session authMiddleware as the rest of the chat
// module. Audited because issuing a token = granting access to a video
// room that may carry PHI.

import { Router } from "express";

import { issueVideoTokenController } from "./video.controller.js";
import authMiddleware from "../../../common/middlewares/authvalidateMiddleware/authMiddleware.js";
import auditMiddleware from "../../audit/middleware/auditMiddleware.js";

const router = Router();

// --- получить токен доступа к видеокомнате ---
//  POST /communication/video/token
//  Body: { kind: "dialog", id: "<dialogId>" }
router.post(
  "/token",
  authMiddleware,
  auditMiddleware({
    resourceType: "video-room",
    action: "communication.video.token",
    // resourceId — чистый ObjectId диалога (поле аудита ждёт ObjectId).
    // Тип комнаты (kind) уходит в metadata, а не в resourceId.
    resourceIdFrom: (req) => req.body?.id || null,
    metaFrom: (req) => ({
      kind: req.body?.kind || null,
    }),
  }),
  issueVideoTokenController,
);

export default router;
