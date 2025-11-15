import { Router } from "express";
import resetPasswordController from "../controllers/resetPasswordController.js";
const router = Router();
router.post("/", resetPasswordController);

export default router;
