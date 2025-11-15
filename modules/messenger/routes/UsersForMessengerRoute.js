import { Router } from "express";

import UsersForMessengerController from "../controllers/UsersForMessengerController.js";

const router = Router();

// Маршрут без параметра userId, защищённый аутентификацией
router.get("/", UsersForMessengerController);

export default router;
