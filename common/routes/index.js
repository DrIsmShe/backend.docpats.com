import { Router } from "express";

import doctorProfileModule from "./../../modules/doctorsProfiles/index.js";
import doctorPatientModule from "../../modules/patientsProfiles/index.js";
import commentsLikesModule from "../../modules/commentsLikes/index.js";
import authModule from "../../modules/auth/index.js";
import myClinicModule from "../../modules/myClinic/index.js";
import adminModule from "../../modules/admin/index.js";
import doctorScheduleRoutes from "../../modules/doctorSchedule/index.js";
import appiontmetForPatientRoutes from "../../modules/patientAppointments/index.js";
import doctorScheduleDashboardRoutes from "../../modules/doctorDashboard/index.js";
import notificationsModule from "../../modules/notifications/index.js";
import AiAssistentModule from "../../modules/aiAssistant/index.js";
import communicationModule from "../../modules/communication/index.js";
import translationArticle from "../routes/article.routes.js";
import translationScientificArticle from "../routes/articleScine.routes.js";
const router = Router();

router.use("/doctor-profile", doctorProfileModule);
router.use("/dashboard", doctorScheduleDashboardRoutes);
router.use("/schedule", doctorScheduleRoutes);
router.use("/appointment-for-patient", appiontmetForPatientRoutes);
router.use("/notifications", notificationsModule);
router.use("/patient-profile", doctorPatientModule);
router.use("/comments", commentsLikesModule);
router.use("/auth", authModule);
router.use("/clinic", myClinicModule);
router.use("/admin", adminModule);
router.use("/ai", AiAssistentModule);
router.use("/communication", communicationModule);
router.use("/doctor-profile", translationArticle); // ← вот сюда
router.use("/doctor-profile", translationScientificArticle); // ← вот сюда
//router.use("/appointments", appointmentsModule);

export default router; // 🔥 Важно! Экспортируем router как default
