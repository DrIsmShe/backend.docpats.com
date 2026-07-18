// server/modules/payments/webhook.routes.js
// ─────────────────────────────────────────────────────────────────────
//   Webhook-роуты платёжных провайдеров. Монтируются ДО session:
//     app.use("/api/payments/webhook", paymentsWebhookRouter)
//   Server-to-server, без cookie/CSRF.
// ─────────────────────────────────────────────────────────────────────

import express from "express";
import { handleWebhook } from "./controllers/webhook.controller.js";

const router = express.Router();

router.post("/:provider", handleWebhook);

export default router;
