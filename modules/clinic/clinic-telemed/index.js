// server/modules/clinic/clinic-telemed/index.js
//
// Thin aggregator for the clinic-telemed module. Mounted in clinic/index.js
// with `router.use("/", clinicTelemedRouter)`.

import express from "express";
import telemedRoutes from "./routes/telemed.routes.js";

const router = express.Router();

router.use("/", telemedRoutes);

export default router;
