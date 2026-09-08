// server/modules/video/controllers/videoAdmin.controller.js
//
// Админские обёртки каталога. Личность администратора берётся из req.userId,
// который проставляет requireAdmin, — не из buildActor: тот собирает
// владельца ролика, а здесь действует не владелец.

import { asyncHandler } from "../../../common/middlewares/errorHandler.js";
import { ValidationError } from "../../../common/utils/errors.js";
import * as admin from "../services/videoAdmin.service.js";
import {
  adminUpdateSchema,
  adminReasonSchema,
  adminListQuerySchema,
  categorySchema,
  categoryPatchSchema,
} from "../validators/videoAdmin.schemas.js";

function throwZod(parsed) {
  throw new ValidationError("Validation failed", {
    issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
  });
}

/* ── Разделы витрины ─────────────────────────────────────────────── */

export const adminCategoriesController = asyncHandler(async (_req, res) => {
  const { adminListCategories } = await import(
    "../services/videoCategory.service.js"
  );
  const { items } = await adminListCategories();
  res.json({ items, count: items.length });
});

export const createCategoryController = asyncHandler(async (req, res) => {
  const parsed = categorySchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  const { createCategory } = await import("../services/videoCategory.service.js");
  const category = await createCategory({ adminId: req.userId, data: parsed.data });
  res.status(201).json({ category });
});

export const updateCategoryController = asyncHandler(async (req, res) => {
  const parsed = categoryPatchSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  const { updateCategory } = await import("../services/videoCategory.service.js");
  const category = await updateCategory({
    adminId: req.userId,
    id: req.params.id,
    patch: parsed.data,
  });
  res.json({ category });
});

/** Удаление снимает полку, но не трогает лежавшие на ней ролики. */
export const deleteCategoryController = asyncHandler(async (req, res) => {
  const { deleteCategory } = await import("../services/videoCategory.service.js");
  const итог = await deleteCategory({ adminId: req.userId, id: req.params.id });
  res.json(итог);
});

export const adminListController = asyncHandler(async (req, res) => {
  const parsed = adminListQuerySchema.safeParse(req.query);
  if (!parsed.success) throwZod(parsed);
  const { items } = await admin.adminList({
    adminId: req.userId,
    query: parsed.data,
  });
  res.json({ items, count: items.length });
});

export const adminGetController = asyncHandler(async (req, res) => {
  const video = await admin.adminGet({ adminId: req.userId, id: req.params.id });
  res.json({ video });
});

export const adminUpdateController = asyncHandler(async (req, res) => {
  const parsed = adminUpdateSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  const video = await admin.adminUpdate({
    adminId: req.userId,
    id: req.params.id,
    patch: parsed.data,
  });
  res.json({ video });
});

export const adminArchiveController = asyncHandler(async (req, res) => {
  const parsed = adminReasonSchema.safeParse(req.body || {});
  if (!parsed.success) throwZod(parsed);
  const video = await admin.adminArchive({
    adminId: req.userId,
    id: req.params.id,
    reason: parsed.data.reason,
  });
  res.json({ video });
});

export const adminUnarchiveController = asyncHandler(async (req, res) => {
  const video = await admin.adminUnarchive({
    adminId: req.userId,
    id: req.params.id,
  });
  res.json({ video });
});

export const adminDeleteController = asyncHandler(async (req, res) => {
  const parsed = adminReasonSchema.safeParse(req.body || {});
  if (!parsed.success) throwZod(parsed);
  const result = await admin.adminDelete({
    adminId: req.userId,
    id: req.params.id,
    reason: parsed.data.reason,
  });
  res.json(result);
});
