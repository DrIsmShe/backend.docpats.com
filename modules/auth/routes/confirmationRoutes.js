import { Router } from "express";
import { confirmationRegister } from "../controllers/confirmationController.js";
import { passwordResetLimiter } from "../../../common/middlewares/rateLimiter.js";
const router = Router();

// H-3: тормозим перебор 6-значного кода подтверждения регистрации по IP.
router.post("/", passwordResetLimiter, confirmationRegister);

export default router;
