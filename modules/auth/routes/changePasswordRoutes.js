import { Router } from "express";
import changePasswordController from "../controllers/changePasswordController.js";
import validatePassword from "../../../common/middlewares/authvalidateMiddleware/validatePassword.js"; // Импортируем middleware
import { passwordResetLimiter } from "../../../common/middlewares/rateLimiter.js";

const router = Router();

// passwordResetLimiter тормозит перебор 6-значного кода по сети.
router.post("/", passwordResetLimiter, validatePassword, changePasswordController); // Добавляем middleware перед контроллером

export default router;
