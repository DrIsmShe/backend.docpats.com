import express from "express";
import authMiddleware from "../../../common/middlewares/authvalidateMiddleware/authMiddleware.js";
import { getDoctorStats } from "../controllers/doctorStatsController.js";
import { getAppointmentAudit } from "../controllers/doctorAuditController.js";
import { getUpcomingAppointments } from "../controllers/getUpcomingAppointments.js";
import { openChatForAppointment } from "../controllers/doctorChatController.js";

const router = express.Router();

// 📊 Статистика врача
router.get("/stats", authMiddleware, getDoctorStats);

// 🧾 История изменений по приёму
router.get("/audit/:id", authMiddleware, getAppointmentAudit);

// ⏰ Напоминания (ближайшие приёмы)
router.get("/upcoming", authMiddleware, getUpcomingAppointments);

// 💬 Чат для приёма
router.post("/chat/:appointmentId", authMiddleware, openChatForAppointment);

export default router;
