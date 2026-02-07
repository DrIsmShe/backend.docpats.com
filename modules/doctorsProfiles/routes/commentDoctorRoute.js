import express from "express";
import { Router } from "express";
import Comment from "../../../common/models/Comments/CommentDocpats.js";
import mongoose from "mongoose";
import { body, query, validationResult } from "express-validator";
import authMiddleware from "../../../common/middlewares/authvalidateMiddleware/authMiddleware.js";
import addCommentDoctor from "../controllers/addCommentDoctorController.js";

const router = Router();

// Валидация входных данных для комментариев
const validateCommentCreation = [
  body("content").notEmpty().withMessage("Content is required"),
  body("author").notEmpty().isMongoId().withMessage("Invalid author ID"),
  body("article").notEmpty().isMongoId().withMessage("Invalid article ID"),
  body("parentComment").optional().isMongoId(),
];

// Валидация пагинации
const validatePagination = [
  query("page").optional().isInt({ min: 1 }).withMessage("Invalid page number"),
  query("limit").optional().isInt({ min: 1 }).withMessage("Invalid limit"),
];

// Обработчик ошибок
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Создать комментарий
router.post(
  "/:id", // Используем articleId для привязки комментария к статье
  authMiddleware,
  validateCommentCreation,
  handleValidationErrors,
  addCommentDoctor
);

export default router;
