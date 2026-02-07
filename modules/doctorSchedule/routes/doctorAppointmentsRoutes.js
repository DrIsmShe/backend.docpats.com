import express from "express";
import {
  getMyAppointments,
  updateAppointmentStatus,
} from "../controllers/doctorAppointmentsController.js";
import deleteMyAppointmentsController from "../controllers/deleteMyAppointmentsController.js";
import authMiddleware from "../../../common/middlewares/authvalidateMiddleware/authMiddleware.js";
import getArchivedAppointmentsController from "../controllers/getArchivedAppointmentsController.js";
import archiveAppointmentController from "../controllers/archiveAppointmentController.js";
import unarchiveAppointmentController from "../controllers/unarchiveAppointmentController.js";
import { confirmAppointmentController } from "../../appointments/controllers/confirmAppointmentController.js";
import { getAppointmentAuditController } from "../controllers/getAppointmentAuditController.js";
const router = express.Router();

// Получить все приёмы врача

router.get("/audit/:appointmentId", getAppointmentAuditController);
router.get("/appointments", authMiddleware, getMyAppointments);
router.delete("/delete/:id", authMiddleware, deleteMyAppointmentsController);
router.delete("/delete", authMiddleware, deleteMyAppointmentsController);
router.put("/archive/:id", authMiddleware, archiveAppointmentController);
router.get("/archived", authMiddleware, getArchivedAppointmentsController);
router.put("/unarchive/:id", authMiddleware, unarchiveAppointmentController);
// Обновить статус приёма
router.patch(
  "/appointments/:id/status",
  authMiddleware,
  updateAppointmentStatus,
);
router.patch(
  "/appointments/:id/confirm",
  authMiddleware,
  confirmAppointmentController,
);
export default router;
