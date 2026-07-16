import { Router } from "express";
import resetPasswordController from "../controllers/resetPasswordController.js";
import { passwordResetLimiter } from "../../../common/middlewares/rateLimiter.js";
const router = Router();
// passwordResetLimiter: каждый запрос шлёт письмо — тормозим спам/перебор адресов.
router.post("/", passwordResetLimiter, resetPasswordController);

export default router;
