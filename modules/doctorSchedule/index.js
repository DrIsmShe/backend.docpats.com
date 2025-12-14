import express from "express";
const router = express.Router();
// DOCTOR PROFILE ROUTES
import doctorScheduleRoutes from "./routes/doctorScheduleRoutes.js";
import addOrUpdateScheduleRoutes from "./routes/addOrUpdateScheduleRoutes.js";
import doctorAppointmentsRoutes from "./routes/doctorAppointmentsRoutes.js";
import addBlockcheduleRoutes from "./routes/addBlockcheduleRoutes.js";
// SHARED ROUTES
router.use("/doctor-schedule", doctorScheduleRoutes);
router.use("/block", addBlockcheduleRoutes);
// ➕ Добавить/обновить расписание (чёрные даты)
router.use("/add-or", addOrUpdateScheduleRoutes);
router.use("/appointment", doctorAppointmentsRoutes);
// Проверка авторизации врача
router.get("/doctorprofilelayout", async (req, res) => {
  console.log("🔍 Checking doctor session: ", req.session);
  console.log("🔍 User ID:", req.session.userId);
  console.log("🔍 User role:", req.session.role);

  if (!req.session.userId) {
    console.warn("⚠️ User is not authorized!");
    return res.status(401).json({
      authenticated: false,
      message: "User is not authorized",
    });
  }

  if (req.session.role !== "doctor") {
    console.warn("⚠️ Access denied! Role:", req.session.role);
    return res.status(403).json({
      authenticated: false,
      message: "Access allowed only for doctors",
    });
  }

  console.log("✅ Access allowed for doctor");
  return res.status(200).json({
    authenticated: true,
    user: {
      role: req.session.role,
    },
  });
});

export default router;
