// server/modules/clinic/clinic-announcements/index.js
//
// Thin aggregator for the clinic-announcements module. Mounted in
// clinic/index.js with `router.use("/", clinicAnnouncementsRouter)`.

import express from "express";
import announcementRoutes from "./routes/announcement.routes.js";

const router = express.Router();
router.use("/", announcementRoutes);

export default router;
