// server/modules/education/education-catalog/index.js
//
// Агрегатор подмодуля каталога. Монтируется в education/index.js.

import express from "express";
import programRoutes from "./routes/program.routes.js";

const router = express.Router();

router.use("/", programRoutes);

export default router;
