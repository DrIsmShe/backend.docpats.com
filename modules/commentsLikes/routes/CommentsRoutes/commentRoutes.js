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

const router = express.Router();

router.post("/create", authMiddleware, createComment);
router.get("/by-ref/:refId", authMiddleware, getCommentsByRef);
router.put("/update/:commentId", authMiddleware, updateComment);
router.delete("/delete/:commentId", authMiddleware, deleteComment);
router.put("/like/:commentId", authMiddleware, toggleLike);
router.post("/comment-count-bulk", getCommentCountBulk);
router.get("/comment-count/:targetId", getCommentCountDetail); // ✅ вот этот маршрут

export default router;
