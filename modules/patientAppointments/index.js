import express from "express";
const router = express.Router();
import patientAppointmentRoutes from "../../modules/patientAppointments/routes/patientAppointmentsRoutes.js";
import getMyAppointmentsRoutes from "../../modules/patientAppointments/routes/getMyAppointmentsRoutes.js";
import getPatientAppointmentsHistoryRoutes from "../../modules/patientAppointments/routes/getPatientAppointmentsHistoryRoutes.js";
import cancelAppointmentByPatientRoutes from "../../modules/patientAppointments/routes/cancelAppointmentByPatientRoutes.js";
import appointmentVideoRoutes from "../../modules/patientAppointments/routes/appointmentVideoRoutes.js";
import patientTelemedVideoRoutes from "../../modules/patientAppointments/routes/patientTelemedVideoRoutes.js";
import patientConsiliumVideoRoutes from "../../modules/patientAppointments/routes/patientConsiliumVideoRoutes.js";
router.use("/book", patientAppointmentRoutes);
router.use("/my", getMyAppointmentsRoutes);
router.use("/my-history", getPatientAppointmentsHistoryRoutes);
router.use("/cancel", cancelAppointmentByPatientRoutes);
// Видео-токен фриланс-приёма (Jitsi). POST /appointment-for-patient/video/:appointmentId/token
router.use("/video", appointmentVideoRoutes);
// Телемед для пациента (Jitsi):
//   GET  /appointment-for-patient/telemed-video/my
//   POST /appointment-for-patient/telemed-video/:sessionId/video-token
router.use("/telemed-video", patientTelemedVideoRoutes);
router.use("/consilium-video", patientConsiliumVideoRoutes);
router.get("/patientprofilelayout", async (req, res) => {
  console.log("🔍 Проверяем сессию: ", req.session);
  console.log("🔍 ID пользователя:", req.session.userId);
  console.log("🔍 Роль пользователя:", req.session.role);
  if (!req.session.userId) {
    console.warn("⚠️ Пользователь не авторизован!");
    return res.status(401).json({
      authenticated: false,
      message: "Пользователь не авторизован",
    });
  }
  if (req.session.role !== "patient") {
    console.warn("⚠️ Доступ запрещен! Роль:", req.session.role);
    return res.status(403).json({
      authenticated: false,
      message: "Доступ разрешен только для пациентов",
    });
  }
  console.log("✅ Доступ разрешен");
  return res.status(200).json({
    authenticated: true,
    user: {
      role: req.session.role,
    },
  });
});
export default router;
