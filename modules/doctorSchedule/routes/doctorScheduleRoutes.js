// server/modules/doctorSchedule/routes/doctorScheduleRoutes.js
import express from "express";
import {
  getMySchedule,
  createOrUpdateSchedule,
  getAvailableSlots,
} from "../controllers/doctorScheduleController.js";
import authMiddleware from "../../../common/middlewares/authvalidateMiddleware/authMiddleware.js";
import { getDoctorSlotsPublic } from "../controllers/getDoctorSlotsPublic.js";
const router = express.Router();

// ✅ исправлено
router.get("/me", authMiddleware, getMySchedule);
router.post("/", authMiddleware, createOrUpdateSchedule);
router.get("/slots/:date", authMiddleware, getAvailableSlots);
router.get("/public-slots/:date/:type", getDoctorSlotsPublic);

export default router;
