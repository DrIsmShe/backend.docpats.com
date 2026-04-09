import { Router } from "express";
import getMyDoctors from "../controllers/getMyDoctors.js";
import authMiddleware from "../../../common/middlewares/authMiddleware.js"; // обязательно!

const router = Router();

router.get("/", authMiddleware, getMyDoctors); // ✅ добавляем промеж authMiddleware

export default router;
