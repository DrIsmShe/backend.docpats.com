// server/modules/clinic/clinic-announcements/routes/announcement.routes.js
//
// Routes for ClinicAnnouncement (corporate-portal bulletin board).
// Mounted in clinic/index.js via `router.use("/", clinicAnnouncementsRouter)`,
// so the full /announcements prefix lives here.
//
// RBAC: like the other clinic-* modules — tenantMiddleware runs upstream and
// the frontend gates write actions to owner/admin/manager. List/get/markRead
// are open to any clinic member.
//
// Route ordering: specific "/announcements/:id/..." subpaths are declared
// BEFORE the bare "/announcements/:id" to avoid shadowing.

import express from "express";
import * as ctrl from "../controllers/announcement.controller.js";

const router = express.Router();

// Collection
router.get("/announcements", ctrl.listAnnouncementsController);
router.post("/announcements", ctrl.createAnnouncementController);

// Specific subpaths (BEFORE bare /:id)
router.post("/announcements/:id/read", ctrl.markReadController);
router.get("/announcements/:id/receipts", ctrl.readReceiptsController);
router.patch("/announcements/:id/pin", ctrl.setPinnedController);
router.patch("/announcements/:id/archive", ctrl.archiveAnnouncementController);
router.patch(
  "/announcements/:id/unarchive",
  ctrl.unarchiveAnnouncementController,
);
// Bare /:id (register LAST among GETs)
router.get("/announcements/:id", ctrl.getAnnouncementController);
router.delete("/announcements/:id", ctrl.deleteAnnouncementController);

export default router;
