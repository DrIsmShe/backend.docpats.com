// server/modules/education/education-attempts/index.js

import express from "express";
import attemptRoutes from "./routes/attempt.routes.js";

const router = express.Router();

router.use("/", attemptRoutes);

export default router;
