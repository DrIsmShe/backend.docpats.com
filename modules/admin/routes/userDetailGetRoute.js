import { Router } from "express";
import UserDetailGetController from "../controllers/UserDetailGetController.js";
import isAdminRoute from "../routes/isAdminRoute.js";
const router = Router();

// Маршрут для изменения роли пользователя
router.get("/:id", isAdminRoute, UserDetailGetController);

export default router;
