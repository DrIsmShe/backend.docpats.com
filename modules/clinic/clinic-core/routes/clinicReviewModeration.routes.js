import express from "express";
import {
  listReviews,
  moderateReview,
} from "../controllers/clinicReviewModeration.controller.js";

const router = express.Router();

router.get("/clinics/:id/reviews", listReviews);
router.patch("/clinics/:id/reviews/:reviewId", moderateReview);

export default router;
