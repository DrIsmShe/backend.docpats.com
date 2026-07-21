// server/modules/education/education-attempts/validators/attempt.schemas.js

import { z } from "zod";
import {
  ATTEMPT_MODES,
  ATTEMPT_STATUSES,
  EXAM_LANGUAGES,
} from "../../constants.js";

const objectIdField = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

// ─── START ───
export const startAttemptSchema = z.object({
  programId: objectIdField,
  mode: z.enum(ATTEMPT_MODES).optional(),
  questionCount: z.number().int().min(1).max(200).optional(),
  durationMinutes: z.number().int().min(1).max(600).optional(),
  lang: z.enum(EXAM_LANGUAGES).optional(),
  topicCodes: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  // Номер блока (0-based) при прохождении большого теста по частям.
  blockIndex: z.number().int().min(0).max(9999).optional(),
});

// ─── ANSWER ───
export const answerSchema = z.object({
  itemId: objectIdField,
  selectedKeys: z.array(z.string().trim().min(1).max(4)).max(10),
  // Время меряет клиент; сервер всё равно обрезает его сверху.
  timeSpentMs: z.number().int().min(0).optional(),
  flagged: z.boolean().optional(),
});

// ─── LIST QUERY ───
export const listAttemptsQuerySchema = z.object({
  programId: objectIdField.optional(),
  status: z.enum(ATTEMPT_STATUSES).optional(),
  mode: z.enum(ATTEMPT_MODES).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
