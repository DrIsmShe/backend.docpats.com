import { Router } from "express";
import deleteUserController from "../controllers/deleteUserController.js";
import requireAdmin from "./isAdminRoute.js";
const router = Router();

router.post("/:id", requireAdmin, deleteUserController);
export default router;
