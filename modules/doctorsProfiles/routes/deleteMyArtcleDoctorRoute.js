import { Router } from "express";
import deleteMyArticleDoctorController from "../controllers/deleteMyArticleDoctorController.js";
const router = Router();

// Маршрут для удаления статьи по ID
router.delete("/:id", deleteMyArticleDoctorController);

export default router;
