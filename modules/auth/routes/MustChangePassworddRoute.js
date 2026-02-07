import { Router } from "express";
import MustChangePassworddController from "../controllers/MustChangePassworddController.js";
import validatePassword from "../../../common/middlewares/authvalidateMiddleware/validatePassword.js"; // Импортируем middleware

const router = Router();

router.post("/", validatePassword, MustChangePassworddController); // Добавляем middleware перед контроллером

export default router;
