import { Router } from "express";
import { UserPatientDetailGetController } from "../controllers/UserPatientDetailGetController.js"; // ← с фигурными скобками
import isAdminRoute from "./isAdminRoute.js"; // ← правильный относительный путь

const router = Router();

// маршрут GET /admin/user-patient-detail-get/:id
router.get("/:id", isAdminRoute, UserPatientDetailGetController);

export default router;
