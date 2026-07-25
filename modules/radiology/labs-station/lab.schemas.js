// server/modules/radiology/labs-station/lab.schemas.js

import { z } from "zod";
import { DIFFICULTIES, SOURCE_KINDS } from "../constants.js";

const objectIdField = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

const panelItemSchema = z.object({
  key: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(60),
  unit: z.string().trim().max(40).optional(),
  refRange: z.string().trim().max(60).optional(),
});

const impressionSchema = z.object({
  correctText: z.string().trim().max(4000).optional(),
  diagnosisKeys: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  diagnosisSynonyms: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
});

const sourceSchema = z.object({
  kind: z.enum(SOURCE_KINDS),
  authority: z.string().trim().max(300).nullish(),
  url: z.string().trim().url().max(1000).nullish(),
  licenseNote: z.string().trim().max(2000).nullish(),
});

export const createLabSchema = z.object({
  title: z.string().trim().min(2).max(300),
  clinicalContext: z.string().trim().max(4000).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  categoryId: objectIdField.nullish(),
  panel: z.array(panelItemSchema).min(1).max(40),
  significantAbnormal: z.array(z.string().trim().min(1).max(40)).max(40).optional(),
  impression: impressionSchema.optional(),
  source: sourceSchema,
});

export const updateLabSchema = z
  .object({
    title: z.string().trim().min(2).max(300).optional(),
    clinicalContext: z.string().trim().max(4000).optional(),
    difficulty: z.enum(DIFFICULTIES).optional(),
    categoryId: objectIdField.nullish(),
    panel: z.array(panelItemSchema).min(1).max(40).optional(),
    significantAbnormal: z.array(z.string().trim().min(1).max(40)).max(40).optional(),
    impression: impressionSchema.optional(),
    source: sourceSchema.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Нужно хотя бы одно поле" });

export const statusLabSchema = z.object({
  status: z.enum(["draft", "published", "archived"]),
});

export const submitLabSchema = z.object({
  flags: z.array(z.string().trim().min(1).max(40)).max(40).optional(),
  impressionText: z.string().trim().max(4000).optional(),
  diagnosisKeys: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
});

export const listLabQuerySchema = z.object({
  scope: z.enum(["published", "all"]).optional(),
  status: z.string().optional(),
});
