// server/modules/clinic/clinic-knowledge/validators/knowledge.schemas.js

import { z } from "zod";
import {
  KNOWLEDGE_STATUSES,
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_VISIBILITIES,
} from "../models/clinicKnowledgeArticle.model.js";

const objectIdField = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

const titleField = z.string().trim().min(1, "title is required").max(300);
const bodyField = z.string().max(100000).nullish();
const summaryField = z.string().trim().max(500).nullish();
const tagsField = z.array(z.string().trim().min(1).max(50)).max(30).optional();

// ─── CREATE ───
export const createArticleSchema = z.object({
  title: titleField,
  body: bodyField,
  summary: summaryField,
  category: z.enum(KNOWLEDGE_CATEGORIES).optional(),
  departmentId: objectIdField.nullish(),
  tags: tagsField,
  visibility: z.enum(KNOWLEDGE_VISIBILITIES).optional(),
  status: z.enum(["draft", "published"]).optional(),
  pinned: z.boolean().optional(),
});

// ─── UPDATE ───
export const updateArticleSchema = z
  .object({
    title: titleField.optional(),
    body: bodyField,
    summary: summaryField,
    category: z.enum(KNOWLEDGE_CATEGORIES).optional(),
    departmentId: objectIdField.nullish(),
    tags: tagsField,
    visibility: z.enum(KNOWLEDGE_VISIBILITIES).optional(),
    status: z.enum(KNOWLEDGE_STATUSES).optional(),
    pinned: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field must be provided",
  });

// ─── LIST QUERY ───
export const listArticlesQuerySchema = z.object({
  category: z.enum(KNOWLEDGE_CATEGORIES).optional(),
  status: z.enum(KNOWLEDGE_STATUSES).optional(),
  departmentId: objectIdField.optional(),
  visibility: z.enum(KNOWLEDGE_VISIBILITIES).optional(),
  tag: z.string().trim().max(50).optional(),
  q: z.string().trim().max(200).optional(),
});
