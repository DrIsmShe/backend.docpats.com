import { Router } from "express";
import { PolyclinicPatientDetailGetController } from "../controllers/PolyclinicPatientDetailGetController.js"; // ← с фигурными скобками
import isAdminRoute from "./isAdminRoute.js"; // ← правильный относительный путь

const router = Router();

router.get("/:id", isAdminRoute, PolyclinicPatientDetailGetController);

export default router;
