import { Router } from "express";
import otpforresetPasswordController from "../controllers/otpforresetPasswordController.js";
const router = Router();

router.post("/", otpforresetPasswordController);

export default router;
