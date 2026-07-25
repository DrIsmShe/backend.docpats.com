// server/modules/radiology/radiology-cases/index.js

import express from "express";
import caseRoutes from "./routes/case.routes.js";

const router = express.Router();
router.use("/", caseRoutes);
export default router;
