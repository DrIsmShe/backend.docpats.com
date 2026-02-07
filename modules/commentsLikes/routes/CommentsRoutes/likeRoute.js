// routes/CommentsRoutes/likeRoute.js

import express from "express";
import isAuthenticated from "../../../../common/middlewares/authvalidateMiddleware/authMiddleware.js"; // если используется export default

import {
  toggleArticleLike,
  toggleDoctorLike,
  getLikeStatus,
} from "../../controllers/commentController/likeController.js";

const router = express.Router();

/**
 * @route   POST /api/likes/article/:articleId
 * @desc    Toggle like for an article
 * @access  Protected
 */
router.post("/article/:articleId", isAuthenticated, toggleArticleLike);

/**
 * @route   POST /api/likes/doctor/:doctorId
 * @desc    Toggle like for a doctor
 * @access  Protected
 */
router.post("/doctor/:doctorId", isAuthenticated, toggleDoctorLike);

router.get("/status/:targetType/:targetId", isAuthenticated, getLikeStatus);

export default router;
