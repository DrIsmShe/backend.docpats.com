import { Router } from "express";
import blockUserController from "../controllers/blockUserController.js";
import requireAdmin from "./isAdminRoute.js";
const router = Router();

router.post("/:id", requireAdmin, blockUserController);
export default router;
