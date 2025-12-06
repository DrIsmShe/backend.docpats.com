import { Router } from "express";

import communicationsRoutes from "./../../modules/communication/index.js";
import doctorProfileModule from "./../../modules/doctorsProfiles/index.js";
import doctorPatientModule from "../../modules/patientsProfiles/index.js";
import commentsLikesModule from "../../modules/commentsLikes/index.js";
import authModule from "../../modules/auth/index.js";
import myClinicModule from "../../modules/myClinic/index.js";
import adminModule from "../../modules/admin/index.js";
import messengerModule from "../../modules/messenger/index.js";
import doctorScheduleRoutes from "../../modules/doctorSchedule/index.js";
import appiontmetForPatientRoutes from "../../modules/patientAppointments/index.js";
import doctorScheduleDashboardRoutes from "../../modules/doctorDashboard/index.js";

import notificationsModule from "../../modules/notifications/index.js";
const router = Router();

router.use("/doctor-profile", doctorProfileModule);
router.use("/dashboard", doctorScheduleDashboardRoutes);
router.use("/schedule", doctorScheduleRoutes);
router.use("/appointment-for-patient", appiontmetForPatientRoutes);
router.use("/notifications", notificationsModule);
router.use("/dp-messenger", messengerModule);
router.use("/patient-profile", doctorPatientModule);
router.use("/comments", commentsLikesModule);
router.use("/auth", authModule);
router.use("/clinic", myClinicModule);
router.use("/admin", adminModule);
//router.use("/appointments", appointmentsModule);

router.use("/communication", communicationsRoutes);

export default router; // 🔥 Важно! Экспортируем router как default
