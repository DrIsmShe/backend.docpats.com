// server/modules/education/education-categories/validators/category.schemas.js

import { z } from "zod";
import { EXAM_LANGUAGES } from "../../constants.js";

const objectIdField = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(200),
  // Язык, на котором админ набрал имя: он же источник перевода на остальные
  // четыре. Не передали — считаем русским, как было до появления языка.
  lang: z.enum(EXAM_LANGUAGES).optional(),
  description: z.string().trim().max(2000).optional(),
  parentId: objectIdField.nullish(),
  order: z.number().int().min(0).max(100000).optional(),
  icon: z.string().trim().max(200).optional(),
  isActive: z.boolean().optional(),
});

export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    lang: z.enum(EXAM_LANGUAGES).optional(),
    description: z.string().trim().max(2000).optional(),
    parentId: objectIdField.nullish(),
    order: z.number().int().min(0).max(100000).optional(),
    icon: z.string().trim().max(200).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field must be provided",
  });

export const listCategoriesQuerySchema = z.object({
  // Область подсчёта числа тестов: витрина видит только опубликованные,
  // админка — все.
  scope: z.enum(["public", "all"]).optional(),
});
