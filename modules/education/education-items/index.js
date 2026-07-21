// server/modules/education/education-items/index.js

import express from "express";
import itemRoutes from "./routes/item.routes.js";

const router = express.Router();

router.use("/", itemRoutes);

export default router;
