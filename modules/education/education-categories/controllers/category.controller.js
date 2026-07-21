// server/modules/education/education-categories/controllers/category.controller.js
//
// HTTP-слой рубрикатора. Тонкий: разбор запроса → сервис → ответ.

import { asyncHandler } from "../../../../common/middlewares/errorHandler.js";
import { ValidationError } from "../../../../common/utils/errors.js";
import {
  listCategoriesTree,
  createCategory,
  updateCategory,
  deleteCategory,
} from "../services/category.service.js";
import {
  createCategorySchema,
  updateCategorySchema,
  listCategoriesQuerySchema,
} from "../validators/category.schemas.js";

function throwZod(parsed) {
  throw new ValidationError("Validation failed", {
    issues: parsed.error.issues.map((i) => ({
      path: i.path,
      message: i.message,
    })),
  });
}

export const listCategoriesController = asyncHandler(async (req, res) => {
  const parsed = listCategoriesQuerySchema.safeParse(req.query);
  if (!parsed.success) throwZod(parsed);

  // Полный подсчёт (все статусы) доступен только редакторам каталога —
  // учащемуся отдаём счётчики по опубликованным публичным тестам.
  let countScope = parsed.data.scope ?? "public";
  const role = req.educationActor?.role;
  if (countScope === "all" && !["admin", "doctor"].includes(role)) {
    countScope = "public";
  }

  const categories = await listCategoriesTree({ countScope });
  res.json({ categories, count: categories.length });
});

export const createCategoryController = asyncHandler(async (req, res) => {
  const parsed = createCategorySchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const category = await createCategory({
    ...parsed.data,
    actorId: req.educationActor?.userId ?? null,
  });
  res.status(201).json({ category });
});

export const updateCategoryController = asyncHandler(async (req, res) => {
  const parsed = updateCategorySchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const category = await updateCategory(req.params.id, {
    ...parsed.data,
    actorId: req.educationActor?.userId ?? null,
  });
  res.json({ category });
});

export const deleteCategoryController = asyncHandler(async (req, res) => {
  const result = await deleteCategory(req.params.id);
  res.json(result);
});
