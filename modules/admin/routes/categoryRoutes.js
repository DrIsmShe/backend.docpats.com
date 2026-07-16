import express from "express";
import {
  createCategory,
  getAllCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
} from "../controllers/categoryController.js";
import requireAdmin from "./isAdminRoute.js";

const router = express.Router();

// Маршруты для категорий
router.post("/", requireAdmin, createCategory); // Создание категории
router.get("/", getAllCategories); // Получение всех категорий
router.get("/:id", getCategoryById); // Получение категории по ID
router.put("/:id", requireAdmin, updateCategory); // Обновление категории
router.delete("/:id", requireAdmin, deleteCategory); // Удаление категории

export default router;
