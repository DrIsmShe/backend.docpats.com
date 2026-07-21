// server/modules/education/education-catalog/validators/program.schemas.js

import { z } from "zod";
import {
  EXAM_REGIONS,
  EXAM_TYPES,
  EXAM_LANGUAGES,
  CATALOG_STATUSES,
  SOURCE_KINDS,
} from "../../constants.js";

const objectIdField = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

// Код программы: латиница, цифры и дефисы — попадает в URL витрины.
const codeField = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(100)
  .regex(/^[a-z0-9-]+$/, "code may contain only a-z, 0-9 and '-'");

// ISO 3166-1 alpha-2 либо "INT".
const countryField = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^([A-Z]{2}|INT)$/, "country must be an ISO alpha-2 code or 'INT'");

const blueprintSectionSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9._-]+$/i, "invalid section code"),
  title: z.string().trim().min(1).max(200),
  parentCode: z.string().trim().max(80).nullish(),
  weightPercent: z.number().min(0).max(100),
});

const translationSchema = z.object({
  lang: z.enum(EXAM_LANGUAGES),
  title: z.string().trim().max(300).optional(),
  description: z.string().trim().max(4000).optional(),
});

// ─── CREATE ───
export const createProgramSchema = z.object({
  code: codeField,
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(4000).optional(),
  translations: z.array(translationSchema).max(10).optional(),
  country: countryField,
  region: z.enum(EXAM_REGIONS),
  examType: z.enum(EXAM_TYPES),
  authority: z.string().trim().max(200).nullish(),
  specialty: z.string().trim().max(120).nullish(),
  languages: z.array(z.enum(EXAM_LANGUAGES)).min(1).max(5).optional(),
  categoryId: objectIdField.nullish(),
  blockSize: z.number().int().min(1).max(500).nullish(),
  blueprint: z.array(blueprintSectionSchema).max(200).optional(),
  defaultQuestionCount: z.number().int().min(1).max(500).optional(),
  defaultDurationMinutes: z.number().int().min(1).max(600).optional(),
  passingScorePercent: z.number().min(0).max(100).optional(),
  sourcePolicy: z.enum(SOURCE_KINDS).optional(),
  sourceUrl: z.string().trim().url().max(1000).nullish(),
  licenseNote: z.string().trim().max(2000).nullish(),
  ownerClinicId: objectIdField.nullish(),
  isFree: z.boolean().optional(),
  status: z.enum(["draft", "published"]).optional(),
});

// ─── UPDATE ───
export const updateProgramSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().trim().max(4000).optional(),
    translations: z.array(translationSchema).max(10).optional(),
    country: countryField.optional(),
    region: z.enum(EXAM_REGIONS).optional(),
    examType: z.enum(EXAM_TYPES).optional(),
    authority: z.string().trim().max(200).nullish(),
    specialty: z.string().trim().max(120).nullish(),
    languages: z.array(z.enum(EXAM_LANGUAGES)).min(1).max(5).optional(),
    categoryId: objectIdField.nullish(),
    blockSize: z.number().int().min(1).max(500).nullish(),
    blueprint: z.array(blueprintSectionSchema).max(200).optional(),
    defaultQuestionCount: z.number().int().min(1).max(500).optional(),
    defaultDurationMinutes: z.number().int().min(1).max(600).optional(),
    passingScorePercent: z.number().min(0).max(100).optional(),
    sourcePolicy: z.enum(SOURCE_KINDS).optional(),
    sourceUrl: z.string().trim().url().max(1000).nullish(),
    licenseNote: z.string().trim().max(2000).nullish(),
    isFree: z.boolean().optional(),
    status: z.enum(CATALOG_STATUSES).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field must be provided",
  });

// ─── LIST QUERY ───
export const listProgramsQuerySchema = z.object({
  scope: z.enum(["public", "clinic", "all"]).optional(),
  status: z.enum(CATALOG_STATUSES).optional(),
  country: countryField.optional(),
  region: z.enum(EXAM_REGIONS).optional(),
  examType: z.enum(EXAM_TYPES).optional(),
  categoryId: objectIdField.optional(),
  specialty: z.string().trim().max(120).optional(),
  language: z.enum(EXAM_LANGUAGES).optional(),
  isFree: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
