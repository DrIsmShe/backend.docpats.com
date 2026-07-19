import { Router } from "express";
import authMiddleware from "../../../common/middlewares/authvalidateMiddleware/authMiddleware.js";
import { commentLimiter } from "../../../common/middlewares/rateLimiter.js";
import {
  submitDoctorReview,
  getDoctorReviews,
  replyToDoctorReview,
} from "../controllers/doctorReview.controller.js";

const router = Router();

// Публичное чтение отзывов о враче (для профиля + SEO).
router.get("/:doctorProfileId", getDoctorReviews);

// Отправка/обновление отзыва — только авторизованно, с анти-спамом.
router.post("/:doctorProfileId", authMiddleware, commentLimiter, submitDoctorReview);

// Ответ врача на отзыв — только владелец профиля.
router.post("/:reviewId/reply", authMiddleware, commentLimiter, replyToDoctorReview);

export default router;
