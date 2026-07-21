// server/modules/education/education-categories/index.js
//
// Агрегатор подмодуля рубрикатора тестов. Монтируется в education/index.js.

import express from "express";
import categoryRoutes from "./routes/category.routes.js";

const router = express.Router();

router.use("/", categoryRoutes);

export default router;
