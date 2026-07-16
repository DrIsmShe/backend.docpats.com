// server/modules/clinic/clinic-knowledge/routes/knowledge.routes.js
//
// Routes for ClinicKnowledgeArticle. Mounted in clinic/index.js via
// `router.use("/", clinicKnowledgeRouter)`, so the full /knowledge prefix lives
// here. RBAC проверяется здесь через requireClinicPerm("knowledge", ...).
// Раньше проверки не было — любая роль могла править базу знаний.

import express from "express";
import * as ctrl from "../controllers/knowledge.controller.js";
import { requireClinicPerm } from "../../../../common/middlewares/requireClinicPerm.js";

const router = express.Router();

router.get("/knowledge", requireClinicPerm("knowledge", "read"), ctrl.listArticlesController);
router.post("/knowledge", requireClinicPerm("knowledge", "write"), ctrl.createArticleController);
router.get("/knowledge/:id", requireClinicPerm("knowledge", "read"), ctrl.getArticleController);
router.patch("/knowledge/:id", requireClinicPerm("knowledge", "write"), ctrl.updateArticleController);
router.delete("/knowledge/:id", requireClinicPerm("knowledge", "delete"), ctrl.archiveArticleController);

export default router;
