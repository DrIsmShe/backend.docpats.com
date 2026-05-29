// modules/clinic/clinic-medical/validators/medicalHistory.schemas.js
//
// Zod validators for clinic-medical endpoints.
// Sprint 2 Phase 2B.

import { z } from "zod";

// ─── Helpers ──────────────────────────────────────────────────────────

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
const objectIdSchema = z.string().regex(objectIdRegex, "Invalid ObjectId");

// mainDiagnosis is a structured object {code, codeTitle, text}.
// On wire it may arrive as a JSON string (FormData) or as a plain object
// (JSON body). We accept BOTH and normalize before validation.
//
// preprocess: if string, try JSON.parse — if it fails, leave as-is so
// next schema gives a meaningful error.
const mainDiagnosisSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  },
  z.object({
    code: z.string().min(1, "ICD-10 code is required").trim(),
    codeTitle: z.string().trim().default(""),
    text: z.string().min(1, "Diagnosis text is required").trim(),
  }),
);

// Optional version of the above — used in UPDATE where the field can be
// omitted entirely. If present, must conform.
const mainDiagnosisOptionalSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  },
  z
    .object({
      code: z.string().min(1).trim(),
      codeTitle: z.string().trim().default(""),
      text: z.string().min(1).trim(),
    })
    .optional(),
);

const trimmedString = z.string().trim();
const trimmedOptional = trimmedString.optional().nullable();

// sharedWith: array of clinicId or single clinicId. Always normalized to array.
const sharedWithSchema = z.preprocess((value) => {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  return [value];
}, z.array(objectIdSchema).default([]));

// ─── CREATE ENCOUNTER ─────────────────────────────────────────────────
//
// body.status: "draft" | "signed"  — controls workflow:
//   - "draft": mainDiagnosis optional, can edit later
//   - "signed": mainDiagnosis required, immutable after (only amend)

export const createEncounterSchema = z
  .object({
    status: z.enum(["draft", "signed"]).default("signed"),

    // PHI content fields — all optional, doctor may save partial draft
    complaints: trimmedOptional,
    anamnesisMorbi: trimmedOptional,
    anamnesisVitae: trimmedOptional,
    statusPreasens: trimmedOptional,
    statusLocalis: trimmedOptional,
    recommendations: trimmedOptional,
    ctScanResults: trimmedOptional,
    mriResults: trimmedOptional,
    ultrasoundResults: trimmedOptional,
    laboratoryTestResults: trimmedOptional,
    additionalDiagnosis: trimmedOptional,

    // Structured diagnosis — required for "signed", optional for "draft"
    mainDiagnosis: mainDiagnosisOptionalSchema,

    // SEO/publication legacy — accept but don't require
    metaDescription: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .nullable(),
    metaKeywords: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .nullable(),
    readTime: z.number().int().nonnegative().optional(),

    // Per-record sharing (clinic IDs that pacient explicitly authorized)
    sharedWith: sharedWithSchema,
  })
  .superRefine((data, ctx) => {
    // Cross-field: signed requires mainDiagnosis
    if (data.status === "signed") {
      if (!data.mainDiagnosis) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mainDiagnosis"],
          message:
            "mainDiagnosis is required when status='signed'. Use status='draft' to save without diagnosis.",
        });
      }
    }
  });

// ─── UPDATE ENCOUNTER ─────────────────────────────────────────────────
//
// PATCH endpoint — only mutable fields. status changes go through
// dedicated sign/amend endpoints, NOT here.
//
// Per UMR rules: signed/amended encounters are read-only for content.
// Service layer enforces this; validator only sanitizes input.

export const updateEncounterSchema = z.object({
  complaints: trimmedOptional,
  anamnesisMorbi: trimmedOptional,
  anamnesisVitae: trimmedOptional,
  statusPreasens: trimmedOptional,
  statusLocalis: trimmedOptional,
  recommendations: trimmedOptional,
  ctScanResults: trimmedOptional,
  mriResults: trimmedOptional,
  ultrasoundResults: trimmedOptional,
  laboratoryTestResults: trimmedOptional,
  additionalDiagnosis: trimmedOptional,
  mainDiagnosis: mainDiagnosisOptionalSchema,
  sharedWith: sharedWithSchema.optional(),
});

// ─── SIGN ENCOUNTER ───────────────────────────────────────────────────
//
// Transition: draft → signed. Service requires mainDiagnosis to exist
// at this moment (either pre-set in draft or supplied here).

export const signEncounterSchema = z.object({
  // Optional fields if doctor wants to fill them at signing moment.
  // Otherwise existing values are used.
  mainDiagnosis: mainDiagnosisOptionalSchema,
  additionalDiagnosis: trimmedOptional,
  recommendations: trimmedOptional,
});

// ─── AMEND ENCOUNTER ──────────────────────────────────────────────────
//
// Transition: signed → amended. Requires explicit reason (audit trail).
// Fields that need correction are passed and replace current values.

export const amendEncounterSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, "Amendment reason must be at least 5 characters")
    .max(500, "Amendment reason too long"),

  // All content fields are optional — amend only what needs correction
  complaints: trimmedOptional,
  anamnesisMorbi: trimmedOptional,
  anamnesisVitae: trimmedOptional,
  statusPreasens: trimmedOptional,
  statusLocalis: trimmedOptional,
  recommendations: trimmedOptional,
  ctScanResults: trimmedOptional,
  mriResults: trimmedOptional,
  ultrasoundResults: trimmedOptional,
  laboratoryTestResults: trimmedOptional,
  additionalDiagnosis: trimmedOptional,
  mainDiagnosis: mainDiagnosisOptionalSchema,
});

// ─── LIST QUERY ───────────────────────────────────────────────────────

export const listEncountersQuerySchema = z.object({
  patientId: objectIdSchema.optional(),
  status: z.enum(["draft", "preliminary", "signed", "amended"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.coerce.date().optional(), // cursor: createdAt < before
});

export default {
  createEncounterSchema,
  updateEncounterSchema,
  signEncounterSchema,
  amendEncounterSchema,
  listEncountersQuerySchema,
};
