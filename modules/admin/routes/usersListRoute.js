import { Router } from "express";
import getUsersListController from "../controllers/getUsersListController.js";
import isAdminRoute from "../routes/isAdminRoute.js";

const router = Router();

// GET запрос для получения списка пользователей
router.get("/", isAdminRoute, getUsersListController);

export default router;
