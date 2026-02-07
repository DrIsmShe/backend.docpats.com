import { Router } from "express";
import { polyclinicGetController } from "../controllers/polyclinicGetController.js"; // ← с фигурными скобками
import isAdminRoute from "./isAdminRoute.js"; // ← правильный относительный путь

const router = Router();

// маршрут GET /admin/user-patient-detail-get/:id
router.get("/get-all", isAdminRoute, polyclinicGetController);

export default router;
