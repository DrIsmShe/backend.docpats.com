// server/modules/education/education-categories/validators/category.schemas.js

import { z } from "zod";

const objectIdField = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  parentId: objectIdField.nullish(),
  order: z.number().int().min(0).max(100000).optional(),
  icon: z.string().trim().max(200).optional(),
  isActive: z.boolean().optional(),
});

export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
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
