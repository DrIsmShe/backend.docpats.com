// server/modules/clinic/clinic-knowledge/controllers/knowledge.controller.js
//
// HTTP controllers for ClinicKnowledgeArticle. Thin layer, same shape as
// clinic-rooms / clinic-equipment controllers.

import { asyncHandler } from "../../../../common/middlewares/errorHandler.js";
import { ValidationError } from "../../../../common/utils/errors.js";
import {
  getCurrentClinicId,
  getCurrentUserId,
} from "../../../../common/context/tenantContext.js";
import {
  createArticle,
  listArticles,
  getArticleById,
  updateArticle,
  archiveArticle,
} from "../services/knowledge.service.js";
import {
  createArticleSchema,
  updateArticleSchema,
  listArticlesQuerySchema,
} from "../validators/knowledge.schemas.js";

function throwZod(parsed) {
  throw new ValidationError("Validation failed", {
    issues: parsed.error.issues.map((i) => ({
      path: i.path,
      message: i.message,
    })),
  });
}

export const createArticleController = asyncHandler(async (req, res) => {
  const clinicId = getCurrentClinicId();
  const parsed = createArticleSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const article = await createArticle(clinicId, {
    ...parsed.data,
    actorId: getCurrentUserId(),
  });
  res.status(201).json({ article });
});

export const listArticlesController = asyncHandler(async (req, res) => {
  const clinicId = getCurrentClinicId();
  const parsed = listArticlesQuerySchema.safeParse(req.query);
  if (!parsed.success) throwZod(parsed);

  const items = await listArticles(clinicId, parsed.data);
  res.json({ items, count: items.length });
});

export const getArticleController = asyncHandler(async (req, res) => {
  const clinicId = getCurrentClinicId();
  const article = await getArticleById(clinicId, req.params.id);
  res.json({ article });
});

export const updateArticleController = asyncHandler(async (req, res) => {
  const clinicId = getCurrentClinicId();
  const parsed = updateArticleSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const article = await updateArticle(clinicId, req.params.id, {
    ...parsed.data,
    actorId: getCurrentUserId(),
  });
  res.json({ article });
});

export const archiveArticleController = asyncHandler(async (req, res) => {
  const clinicId = getCurrentClinicId();
  const article = await archiveArticle(clinicId, req.params.id);
  res.json({ article });
});
