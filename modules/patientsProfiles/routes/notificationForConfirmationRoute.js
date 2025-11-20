import { Router } from "express";
import notificationForConfirmationController from "../controllers/notificationForConfirmationController.js";
import markNotificationAsReadController from "../controllers/markNotificationAsReadController.js";

const router = Router();

router.get("/", notificationForConfirmationController);
router.post("/mark-as-read/:id", markNotificationAsReadController); // 🔹 Новый маршрут для пометки как прочитанное

export default router;
