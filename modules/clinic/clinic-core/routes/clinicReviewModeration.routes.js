import express from "express";
import {
  listReviews,
  moderateReview,
  listPublicFeedback,
} from "../controllers/clinicReviewModeration.controller.js";

const router = express.Router();

router.get("/clinics/:id/reviews", listReviews);
router.patch("/clinics/:id/reviews/:reviewId", moderateReview);
// Отзывы врачам и комментарии с публичных страниц клиники — только чтение.
router.get("/clinics/:id/public-feedback", listPublicFeedback);

export default router;
