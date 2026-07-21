// server/modules/education/education-items/controllers/item.controller.js

import { asyncHandler } from "../../../../common/middlewares/errorHandler.js";
import { ValidationError } from "../../../../common/utils/errors.js";
import {
  createItem,
  listItems,
  getItemById,
  updateItem,
  submitForReview,
  reviewItem,
  archiveItem,
  itemAnalysis,
} from "../services/item.service.js";
import {
  createItemSchema,
  updateItemSchema,
  reviewItemSchema,
  listItemsQuerySchema,
} from "../validators/item.schemas.js";

function throwZod(parsed) {
  throw new ValidationError("Validation failed", {
    issues: parsed.error.issues.map((i) => ({
      path: i.path,
      message: i.message,
    })),
  });
}

export const createItemController = asyncHandler(async (req, res) => {
  const parsed = createItemSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const item = await createItem({
    ...parsed.data,
    actorId: req.educationActor?.userId ?? null,
  });
  res.status(201).json({ item });
});

export const listItemsController = asyncHandler(async (req, res) => {
  const parsed = listItemsQuerySchema.safeParse(req.query);
  if (!parsed.success) throwZod(parsed);

  const items = await listItems(parsed.data);
  res.json({ items, count: items.length });
});

export const getItemController = asyncHandler(async (req, res) => {
  const item = await getItemById(req.params.id);
  res.json({ item });
});

export const updateItemController = asyncHandler(async (req, res) => {
  const parsed = updateItemSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const item = await updateItem(req.params.id, {
    ...parsed.data,
    actorId: req.educationActor?.userId ?? null,
  });
  res.json({ item });
});

export const submitForReviewController = asyncHandler(async (req, res) => {
  const item = await submitForReview(
    req.params.id,
    req.educationActor?.userId ?? null,
  );
  res.json({ item });
});

export const reviewItemController = asyncHandler(async (req, res) => {
  const parsed = reviewItemSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const item = await reviewItem(req.params.id, {
    decision: parsed.data.decision,
    reason: parsed.data.reason ?? null,
    reviewerId: req.educationActor?.userId,
  });
  res.json({ item });
});

export const archiveItemController = asyncHandler(async (req, res) => {
  const item = await archiveItem(req.params.id);
  res.json({ item });
});

// Отчёт по качеству банка: какие вопросы стоит переписать.
export const itemAnalysisController = asyncHandler(async (req, res) => {
  const minServed = Number(req.query.minServed) || 20;
  const report = await itemAnalysis(req.params.programId, { minServed });
  res.json({ report, count: report.length });
});
