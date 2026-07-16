import { Router } from "express";
import updateUserRoleController from "../controllers/updateUserRoleController.js";
import requireAdmin from "./isAdminRoute.js";

const router = Router();

// Маршрут для изменения роли пользователя
router.put("/users-role-update/:id", requireAdmin, updateUserRoleController);

export default router;
