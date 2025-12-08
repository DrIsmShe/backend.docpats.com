import { Router } from "express";
import doctorDashboardRoutes from "./routes/doctorDashboardRoutes.js";

const router = Router();

router.use("/api", doctorDashboardRoutes);

export default router;
