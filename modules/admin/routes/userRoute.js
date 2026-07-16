import { Router } from "express";
import changeUserRole from "../controllers/changeUserController.js";
import requireAdmin from "./isAdminRoute.js";
const router = Router();

router.put("/", requireAdmin, changeUserRole);

export default router;
