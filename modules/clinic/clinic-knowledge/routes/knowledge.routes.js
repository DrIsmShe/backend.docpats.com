// server/modules/clinic/clinic-knowledge/routes/knowledge.routes.js
//
// Routes for ClinicKnowledgeArticle. Mounted in clinic/index.js via
// `router.use("/", clinicKnowledgeRouter)`, so the full /knowledge prefix
// lives here. No requirePermission — RBAC handled like the other clinic-*
// modules (tenantMiddleware upstream + frontend gating).

import express from "express";
import * as ctrl from "../controllers/knowledge.controller.js";

const router = express.Router();

router.get("/knowledge", ctrl.listArticlesController);
router.post("/knowledge", ctrl.createArticleController);
router.get("/knowledge/:id", ctrl.getArticleController);
router.patch("/knowledge/:id", ctrl.updateArticleController);
router.delete("/knowledge/:id", ctrl.archiveArticleController);

export default router;
