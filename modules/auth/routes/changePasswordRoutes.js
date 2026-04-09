import { Router } from "express";
import changePasswordController from "../controllers/changePasswordController.js";
import validatePassword from "../../../common/middlewares/authvalidateMiddleware/validatePassword.js"; // Импортируем middleware

const router = Router();

router.post("/", validatePassword, changePasswordController); // Добавляем middleware перед контроллером

export default router;
