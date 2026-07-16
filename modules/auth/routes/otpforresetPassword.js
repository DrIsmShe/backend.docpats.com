import { Router } from "express";
import otpforresetPasswordController from "../controllers/otpforresetPasswordController.js";
import { passwordResetLimiter } from "../../../common/middlewares/rateLimiter.js";
const router = Router();

// passwordResetLimiter: ограничивает переотправку OTP (спам/перебор адресов).
router.post("/", passwordResetLimiter, otpforresetPasswordController);

export default router;
