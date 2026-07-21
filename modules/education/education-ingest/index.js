// server/modules/education/education-ingest/index.js

import express from "express";
import ingestRoutes from "./routes/ingest.routes.js";

const router = express.Router();

router.use("/", ingestRoutes);

export default router;
