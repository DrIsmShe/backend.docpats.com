// server/modules/clinic/clinic-knowledge/index.js
//
// Thin aggregator for the clinic-knowledge module. Mounted in
// clinic/index.js with `router.use("/", clinicKnowledgeRouter)`.

import express from "express";
import knowledgeRoutes from "./routes/knowledge.routes.js";

const router = express.Router();

router.use("/", knowledgeRoutes);

export default router;
