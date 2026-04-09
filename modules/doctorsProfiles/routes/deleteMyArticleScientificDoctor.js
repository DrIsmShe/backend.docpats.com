import { Router } from "express";
import deleteMyArticleScientificDoctorController from "../controllers/deleteMyArticleScientificDoctorController.js";
const router = Router();

// Маршрут для удаления статьи по ID
router.delete("/:id", deleteMyArticleScientificDoctorController);

export default router;
