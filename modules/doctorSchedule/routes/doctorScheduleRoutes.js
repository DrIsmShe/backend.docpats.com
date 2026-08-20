// server/modules/doctorSchedule/routes/doctorScheduleRoutes.js
import express from "express";
import {
  getMySchedule,
  createOrUpdateSchedule,
  getAvailableSlots,
} from "../controllers/doctorScheduleController.js";
import authMiddleware from "../../../common/middlewares/authvalidateMiddleware/authMiddleware.js";
import { getDoctorSlotsPublic } from "../controllers/getDoctorSlotsPublic.js";
import { getDoctorDayController } from "../controllers/getDoctorDayController.js";
import requireDoctorPatientLimit from "../../../common/middlewares/requireDoctorPatientLimit.js";
import requireVerifiedDoctorSchedule from "../../../common/middlewares/requireVerifiedDoctorSchedule.js";

const router = express.Router();

// ✅ исправлено
router.get("/me", authMiddleware, getMySchedule);
router.post(
  "/",
  authMiddleware,
  requireDoctorPatientLimit,
  requireVerifiedDoctorSchedule,
  createOrUpdateSchedule,
);
router.get("/slots/:date", authMiddleware, getAvailableSlots);
router.get("/public-slots/:date/:type", getDoctorSlotsPublic);
// День врача теми же слотами, что видит пациент, плюс «занято/свободно».
// Раньше кабинет врача рисовал собственную сетку 08:00–17:00, не связанную
// с расписанием, — записывать из неё было нельзя.
router.get("/day/:date", authMiddleware, getDoctorDayController);

export default router;
