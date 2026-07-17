import express from "express";
import {
  createComment,
  getCommentsByRef,
  updateComment,
  deleteComment,
  toggleLike,
  getCommentCountBulk,
  getCommentCountDetail,
} from "../../controllers/commentController/commentController.js";
import authMiddleware from "../../../../common/middlewares/authvalidateMiddleware/authMiddleware.js";
import { commentLimiter } from "../../../../common/middlewares/rateLimiter.js";

const router = express.Router();

// commentLimiter — анти-спам на создание/редактирование контента и лайки.
router.post("/create", authMiddleware, commentLimiter, createComment);
router.get("/by-ref/:refId", authMiddleware, getCommentsByRef);
router.put("/update/:commentId", authMiddleware, commentLimiter, updateComment);
router.delete("/delete/:commentId", authMiddleware, deleteComment);
router.put("/like/:commentId", authMiddleware, commentLimiter, toggleLike);
router.post("/comment-count-bulk", getCommentCountBulk);
router.get("/comment-count/:targetId", getCommentCountDetail); // ✅ вот этот маршрут

export default router;
