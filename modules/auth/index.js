import express from "express";
const router = express.Router();
// system USER start

import registerRoute from "./routes/registerRoutes.js";
import loginRoute from "./routes/loginRoutes.js";
import confirmationRoute from "./routes/confirmationRoutes.js";
import confirmationChildeRoute from "./routes/confirmationChildeRoute.js";
import resetPasswordRoute from "./routes/resetPasswordRoutes.js";
import otpforresetPasswordRoute from "./routes/otpforresetPassword.js";
import changePasswordRoute from "./routes/changePasswordRoutes.js";
import MustChangePassworddRoute from "./routes/MustChangePassworddRoute.js";
import logoutRoute from "./routes/logoutRoute.js";
// system USER end
// система auth USER start
router.use((req, res, next) => {
  console.log(`${req.method} request for '${req.url}'`);
  next();
});
router.use("/register", registerRoute); // регистрация
router.use("/login", loginRoute); // авторизация
router.use("/confirmation", confirmationRoute); // otp пароль для регистрации и авторизация
router.use("/confirmation-child", confirmationChildeRoute); // otp пароль для регистрации и авторизация
router.use("/reset-password", resetPasswordRoute); // страница email для отправки otp пароля
router.use("/otp-for-reset-password", otpforresetPasswordRoute); // страница otp для подтверждения электронного адреса и права изменения пароля
router.use("/change-password", changePasswordRoute); // страница изменения пароля
router.use("/Must-Change-Password-true", MustChangePassworddRoute); // страница изменения пароля
router.use("/logout", logoutRoute); //выход из авторизации
// система auth USER end
export default router;
