// server/modules/clinic/clinic-consilium/routes/consilium.routes.js
//
// Routes for Consilium + messages. Mounted in clinic/index.js via
// `router.use("/", clinicConsiliumRouter)`, so the full /consilia prefix
// lives here. No requirePermission — RBAC handled like the other clinic-*
// modules. Message routes carry an extra /messages segment so they never
// collide with /consilia/:id.

import express from "express";
import * as ctrl from "../controllers/consilium.controller.js";
import { issueConsiliumVideoTokenController } from "../controllers/consiliumVideo.controller.js";

const router = express.Router();

// Collection
router.get("/consilia", ctrl.listConsiliaController);
router.post("/consilia", ctrl.createConsiliumController);

// Messages (more specific — declared before the bare /:id routes)
router.get("/consilia/:id/messages", ctrl.listMessagesController);
router.post("/consilia/:id/messages", ctrl.createMessageController);

// Video room token (specific segment — declared before the bare /:id routes)
router.post("/consilia/:id/video-token", issueConsiliumVideoTokenController);

// Single consilium
router.get("/consilia/:id", ctrl.getConsiliumController);
router.patch("/consilia/:id", ctrl.updateConsiliumController);
router.delete("/consilia/:id", ctrl.archiveConsiliumController);

export default router;
