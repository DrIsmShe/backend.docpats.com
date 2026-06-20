// server/modules/clinic/clinic-equipment/index.js
//
// Thin aggregator for the clinic-equipment module. Mounted in
// clinic/index.js with `router.use("/", clinicEquipmentRouter)`.

import express from "express";
import equipmentRoutes from "./routes/equipment.routes.js";

const router = express.Router();

router.use("/", equipmentRoutes);

export default router;
