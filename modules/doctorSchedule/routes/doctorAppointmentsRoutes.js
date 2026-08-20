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
import { bookByDoctorController } from "../controllers/bookByDoctorController.js";
import { searchMyPatientsController } from "../controllers/searchMyPatientsController.js";
const router = express.Router();

// Получить все приёмы врача

router.get("/audit/:appointmentId", getAppointmentAuditController);
router.get("/appointments", authMiddleware, getMyAppointments);
// Врач записывает пациента сам: зарегистрированного, приватного или
// человека, которого в списках ещё нет (пришёл на приём / позвонил).
router.post("/book-by-doctor", authMiddleware, bookByDoctorController);
// Поиск среди СВОИХ пациентов для формы записи — и аккаунты, и карточки.
router.get("/my-patients", authMiddleware, searchMyPatientsController);
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
