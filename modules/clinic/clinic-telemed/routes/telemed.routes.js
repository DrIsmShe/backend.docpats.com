// server/modules/clinic/clinic-telemed/routes/telemed.routes.js
//
// Routes for TelemedSession. Mounted in clinic/index.js via
// `router.use("/", clinicTelemedRouter)`, so the full /telemed prefix lives
// here. No requirePermission — RBAC handled like the other clinic-* modules.

import express from "express";
import * as ctrl from "../controllers/telemed.controller.js";
import { issueTelemedVideoTokenController } from "../controllers/telemedVideo.controller.js";

const router = express.Router();

router.get("/telemed", ctrl.listSessionsController);
router.post("/telemed", ctrl.createSessionController);

// Video room token (specific segment — declared before the bare /:id routes)
router.post("/telemed/:id/video-token", issueTelemedVideoTokenController);

router.get("/telemed/:id", ctrl.getSessionController);
router.patch("/telemed/:id", ctrl.updateSessionController);
router.delete("/telemed/:id", ctrl.cancelSessionController);

export default router;
