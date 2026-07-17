import { Router } from "express";
import { registerUser } from "../controllers/regController.js";
import specialization from "../controllers/specialization.js";
import validateRegistration from "../../../common/middlewares/authvalidateMiddleware/registerValidate.js";
import verifyChildOtp from "../controllers/verifyChildOtp.js";
import verifyParentOtp from "../controllers/verifyParentOtp.js";
import { checkUserType } from "../controllers/checkType.js";
import { passwordResetLimiter } from "../../../common/middlewares/rateLimiter.js";
const router = Router();

router.post("/", validateRegistration, registerUser);
router.get("/get-specialization", specialization);
// Тормозим перебор OTP-кодов подтверждения по IP.
router.post("/verify-child-otp", passwordResetLimiter, verifyChildOtp);
router.post("/verify-parent-otp", passwordResetLimiter, verifyParentOtp);

router.post("/check-type", checkUserType);

export default router;
