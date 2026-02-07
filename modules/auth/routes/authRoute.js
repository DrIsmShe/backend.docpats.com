import { Router } from "express";
import changePasswordController from "../controllers/changePasswordController.js";
import validatePassword from "../../../common/middlewares/authvalidateMiddleware/validatePassword.js";
import { confirmationRegister } from "../controllers/confirmationController.js";
import { loginUser } from "../controllers/loginController.js";
import logoutController from "../controllers/logoutController.js";
import otpforresetPasswordController from "../controllers/otpforresetPasswordController.js";
import { registerUser } from "../controllers/regController.js";
import validateRegistration from "../../../common/middlewares/authvalidateMiddleware/registerValidate.js";
import resetPasswordController from "../controllers/resetPasswordController.js";

const router = Router();

// === Изменение пароля ===
router.post("/change-password", validatePassword, changePasswordController);

// === Подтверждение регистрации ===
router.post("/confirm-register", confirmationRegister);

// === Авторизация ===
router.post("/login", loginUser);
router.post("/logout", logoutController);

// === Сброс пароля ===
router.post("/otp-reset-password", otpforresetPasswordController);
router.post("/reset-password", resetPasswordController);

// === Регистрация ===
router.post("/register", validateRegistration, registerUser);

export default router;
