// server/modules/education/education-items/validators/item.schemas.js

import { z } from "zod";
import {
  ITEM_TYPES,
  ITEM_STATUSES,
  ITEM_DIFFICULTIES,
  EXAM_LANGUAGES,
  SOURCE_KINDS,
} from "../../constants.js";

const objectIdField = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

const optionSchema = z.object({
  key: z.string().trim().min(1).max(4),
  text: z.string().trim().min(1).max(2000),
  imageUrl: z.string().trim().url().max(1000).nullish(),
  explanation: z.string().trim().max(4000).optional(),
});

const referenceSchema = z.object({
  title: z.string().trim().min(1).max(500),
  url: z.string().trim().url().max(1000).nullish(),
  year: z.number().int().min(1900).max(2200).nullish(),
});

const sourceSchema = z.object({
  kind: z.enum(SOURCE_KINDS),
  authority: z.string().trim().max(300).nullish(),
  url: z.string().trim().url().max(1000).nullish(),
  year: z.number().int().min(1900).max(2200).nullish(),
  licenseNote: z.string().trim().max(2000).nullish(),
});

// ─── CREATE ───
export const createItemSchema = z.object({
  programId: objectIdField,
  topicCode: z.string().trim().max(80).nullish(),
  lang: z.enum(EXAM_LANGUAGES).optional(),
  type: z.enum(ITEM_TYPES).optional(),
  stem: z.string().trim().min(1).max(8000),
  stemImageUrl: z.string().trim().url().max(1000).nullish(),
  options: z.array(optionSchema).min(2).max(10),
  correctKeys: z.array(z.string().trim().min(1).max(4)).min(1).max(10),
  explanation: z.string().trim().max(8000).optional(),
  references: z.array(referenceSchema).max(20).optional(),
  difficulty: z.enum(ITEM_DIFFICULTIES).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(30).optional(),
  source: sourceSchema,
});

// ─── UPDATE ───
export const updateItemSchema = z
  .object({
    topicCode: z.string().trim().max(80).nullish(),
    lang: z.enum(EXAM_LANGUAGES).optional(),
    type: z.enum(ITEM_TYPES).optional(),
    stem: z.string().trim().min(1).max(8000).optional(),
    stemImageUrl: z.string().trim().url().max(1000).nullish(),
    options: z.array(optionSchema).min(2).max(10).optional(),
    correctKeys: z.array(z.string().trim().min(1).max(4)).min(1).max(10).optional(),
    explanation: z.string().trim().max(8000).optional(),
    references: z.array(referenceSchema).max(20).optional(),
    difficulty: z.enum(ITEM_DIFFICULTIES).optional(),
    tags: z.array(z.string().trim().min(1).max(50)).max(30).optional(),
    source: sourceSchema.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field must be provided",
  });

// ─── REVIEW ───
export const reviewItemSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    reason: z.string().trim().max(2000).optional(),
  })
  .refine((d) => d.decision !== "reject" || (d.reason && d.reason.length > 0), {
    message: "reason is required when rejecting",
    path: ["reason"],
  });

// ─── LIST QUERY ───
export const listItemsQuerySchema = z.object({
  programId: objectIdField.optional(),
  status: z.enum(ITEM_STATUSES).optional(),
  topicCode: z.string().trim().max(80).optional(),
  lang: z.enum(EXAM_LANGUAGES).optional(),
  type: z.enum(ITEM_TYPES).optional(),
  difficulty: z.enum(ITEM_DIFFICULTIES).optional(),
  sourceKind: z.enum(SOURCE_KINDS).optional(),
  importJobId: objectIdField.optional(),
  tag: z.string().trim().max(50).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
