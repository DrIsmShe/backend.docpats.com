import { Router } from "express";
import updateUserRoleController from "../controllers/updateUserRoleController.js";

const router = Router();

// Маршрут для изменения роли пользователя
router.put("/users-role-update/:id", updateUserRoleController);

export default router;
