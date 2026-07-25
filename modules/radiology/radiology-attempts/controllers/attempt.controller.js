// server/modules/radiology/radiology-attempts/controllers/attempt.controller.js

import { asyncHandler } from "../../../../common/middlewares/errorHandler.js";
import { ValidationError } from "../../../../common/utils/errors.js";
import {
  startAttempt,
  submitAttempt,
  getAttempt,
  listAttempts,
  aiAnalyzeAttempt,
} from "../services/attempt.service.js";
import {
  startAttemptSchema,
  submitAttemptSchema,
  listAttemptsQuerySchema,
} from "../validators/attempt.schemas.js";

function throwZod(parsed) {
  throw new ValidationError("Validation failed", {
    issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
  });
}

export const startAttemptController = asyncHandler(async (req, res) => {
  const parsed = startAttemptSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  const result = await startAttempt(
    req.params.id,
    req.radiologyActor.userId,
    parsed.data.mode ?? "learn",
  );
  res.status(201).json(result);
});

export const submitAttemptController = asyncHandler(async (req, res) => {
  const parsed = submitAttemptSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  const result = await submitAttempt(
    req.params.id,
    req.radiologyActor.userId,
    parsed.data,
  );
  res.json(result);
});

export const getAttemptController = asyncHandler(async (req, res) => {
  const result = await getAttempt(req.params.id, req.radiologyActor.userId);
  res.json(result);
});

// ИИ-разбор сданной попытки: диагноз, заключение, разбор ответа.
export const aiAnalysisController = asyncHandler(async (req, res) => {
  const analysis = await aiAnalyzeAttempt(
    req.params.id,
    req.radiologyActor.userId,
  );
  res.json({ analysis });
});

export const listAttemptsController = asyncHandler(async (req, res) => {
  const parsed = listAttemptsQuerySchema.safeParse(req.query);
  if (!parsed.success) throwZod(parsed);
  const items = await listAttempts(req.radiologyActor.userId, parsed.data);
  res.json({ items, count: items.length });
});
