import { Router } from "express";
import { loginUser } from "../controllers/loginController.js";
import { loginLimiter } from "../../../common/middlewares/rateLimiter.js";
const router = Router();

// loginLimiter тормозит подбор паролей / credential-stuffing по IP.
router.post("/", loginLimiter, loginUser);

export default router;
