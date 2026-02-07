import express from "express";
import {
  createCategory,
  getAllCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
} from "../controllers/categoryController.js";

const router = express.Router();

// Маршруты для категорий
router.post("/", createCategory); // Создание категории
router.get("/", getAllCategories); // Получение всех категорий
router.get("/:id", getCategoryById); // Получение категории по ID
router.put("/:id", updateCategory); // Обновление категории
router.delete("/:id", deleteCategory); // Удаление категории

export default router;
