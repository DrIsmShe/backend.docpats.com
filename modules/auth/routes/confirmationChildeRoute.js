import { Router } from "express";
import { confirmationChildeController } from "../controllers/confirmationChildeController.js";
import { passwordResetLimiter } from "../../../common/middlewares/rateLimiter.js";
const router = Router();

// Тормозим перебор детского/родительского кода подтверждения по IP.
router.post("/", passwordResetLimiter, confirmationChildeController);

export default router;
