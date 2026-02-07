import express from "express";
import {
  addBlockDate,
  getBlockedDays,
} from "../controllers/addBlackDateController.js";
import authMiddleware from "../../../common/middlewares/authvalidateMiddleware/authMiddleware.js";

const router = express.Router();

// 🔹 Получение списка блокировок (по расписанию врача)
router.get("/blackout-days", authMiddleware, getBlockedDays);

// 🔹 Добавление / снятие блокировки
router.post("/add", authMiddleware, addBlockDate);
router.delete("/remove", authMiddleware, addBlockDate);

export default router;
