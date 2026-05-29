// modules/clinic/clinic-medical/validators/subRecords.schemas.js
//
// Zod validators for clinic-medical patient-attribute sub-records.
// Sprint 2 Phase 2C.
//
// Each sub-model has a create + update schema. Update schemas are partial
// (all fields optional) — only present fields are applied.

import { z } from "zod";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
const objectIdSchema = z.string().regex(objectIdRegex, "Invalid ObjectId");

const sharedWithSchema = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  return [value];
}, z.array(objectIdSchema).optional());

const nonEmptyText = z.string().trim().min(1, "Field cannot be empty");
const optionalText = z.string().trim().optional().nullable();

// ─── ALLERGY ──────────────────────────────────────────────────────────
// content: free text describing the allergy ("Penicillin → rash")

export const createAllergySchema = z.object({
  content: nonEmptyText,
  sharedWith: sharedWithSchema,
});

export const updateAllergySchema = z.object({
  content: nonEmptyText.optional(),
  sharedWith: sharedWithSchema,
});

// ─── CHRONIC DISEASE ──────────────────────────────────────────────────
// content: free text ("Type 2 diabetes, since 2019")

export const createChronicSchema = z.object({
  content: nonEmptyText,
  sharedWith: sharedWithSchema,
});

export const updateChronicSchema = z.object({
  content: nonEmptyText.optional(),
  sharedWith: sharedWithSchema,
});

// ─── OPERATION ────────────────────────────────────────────────────────
// content: free text ("Appendectomy 2015")

export const createOperationSchema = z.object({
  content: nonEmptyText,
  sharedWith: sharedWithSchema,
});

export const updateOperationSchema = z.object({
  content: nonEmptyText.optional(),
  sharedWith: sharedWithSchema,
});

// ─── FAMILY HISTORY ───────────────────────────────────────────────────
// relative + diseaseName required, content optional

export const createFamilyHistorySchema = z.object({
  relative: nonEmptyText,
  diseaseName: nonEmptyText,
  content: optionalText,
  sharedWith: sharedWithSchema,
});

export const updateFamilyHistorySchema = z.object({
  relative: nonEmptyText.optional(),
  diseaseName: nonEmptyText.optional(),
  content: optionalText,
  sharedWith: sharedWithSchema,
});

// ─── IMMUNIZATION ─────────────────────────────────────────────────────
// vaccineName required, dateGiven + content optional

export const createImmunizationSchema = z.object({
  vaccineName: nonEmptyText,
  dateGiven: z.coerce.date().optional(),
  content: optionalText,
  sharedWith: sharedWithSchema,
});

export const updateImmunizationSchema = z.object({
  vaccineName: nonEmptyText.optional(),
  dateGiven: z.coerce.date().optional(),
  content: optionalText,
  sharedWith: sharedWithSchema,
});

// ─── LIST QUERY (shared by all sub-records) ───────────────────────────

export const listSubRecordsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  before: z.coerce.date().optional(),
});

export default {
  createAllergySchema,
  updateAllergySchema,
  createChronicSchema,
  updateChronicSchema,
  createOperationSchema,
  updateOperationSchema,
  createFamilyHistorySchema,
  updateFamilyHistorySchema,
  createImmunizationSchema,
  updateImmunizationSchema,
  listSubRecordsQuerySchema,
};
