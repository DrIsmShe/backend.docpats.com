import express from "express";
import checkEmailController from "../controllers/checkEmailController.js";

const router = express.Router();

// Эндпоинт для проверки существования email
router.get("/check-email", checkEmailController);

export default router;
