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
import { requireClinicPerm } from "../../../../common/middlewares/requireClinicPerm.js";

const router = express.Router();

// RBAC: создание/закрепление/архив/удаление объявлений — owner/admin/manager
// (ресурс "announcement"). Раньше проверки не было. Чтение и отметка
// «прочитано» доступны всем членам клиники — это их личное действие.

// Collection
router.get("/announcements", ctrl.listAnnouncementsController);
router.post("/announcements", requireClinicPerm("announcement", "write"), ctrl.createAnnouncementController);

// Specific subpaths (BEFORE bare /:id)
router.post("/announcements/:id/read", ctrl.markReadController); // личное действие любого члена
router.get("/announcements/:id/receipts", requireClinicPerm("announcement", "read"), ctrl.readReceiptsController);
router.patch("/announcements/:id/pin", requireClinicPerm("announcement", "write"), ctrl.setPinnedController);
router.patch("/announcements/:id/archive", requireClinicPerm("announcement", "write"), ctrl.archiveAnnouncementController);
router.patch(
  "/announcements/:id/unarchive",
  requireClinicPerm("announcement", "write"),
  ctrl.unarchiveAnnouncementController,
);
// Bare /:id (register LAST among GETs)
router.get("/announcements/:id", ctrl.getAnnouncementController);
router.delete("/announcements/:id", requireClinicPerm("announcement", "delete"), ctrl.deleteAnnouncementController);

export default router;
