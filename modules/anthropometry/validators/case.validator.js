import { z } from "zod";
import { ObjectIdSchema } from "./_shared.js";

const PROCEDURE_TYPES = [
  "rhinoplasty",
  "mammoplasty",
  "facelift",
  "blepharoplasty",
  "liposuction",
  "otoplasty",
  "other",
];

const CASE_STATUSES = [
  "consultation",
  "planned",
  "operated",
  "follow_up",
  "closed",
  "cancelled",
];

/* ============================================================
   POST /cases
   ============================================================ */
/* Inline-поля для создания приватного пациента в одном запросе */
const PrivatePatientInlineSchema = z.object({
  firstName: z.string().trim().min(1).max(200),
  lastName: z.string().trim().max(200).optional(),
  gender: z.enum(["male", "female", "other", "unknown"]).optional(),
  dateOfBirth: z.coerce.date().optional(),
  notes: z.string().max(2000).optional(),
});

export const createCaseSchema = z
  .object({
    patientType: z.enum(["registered", "private"]),
    patientId: ObjectIdSchema.optional(), // ← теперь опциональное
    privatePatient: PrivatePatientInlineSchema.optional(), // ← новое поле
    procedureType: z.enum(PROCEDURE_TYPES),
    doctorProfileId: ObjectIdSchema.optional(),
    chiefComplaint: z.string().max(2000).optional(),
    medicalNotes: z.string().max(10000).optional(),
  })
  .refine(
    (d) => d.patientId || (d.patientType === "private" && d.privatePatient),
    {
      message:
        "Either patientId (for existing patient) or privatePatient inline object (for new private patient) is required",
      path: ["patientId"],
    },
  );
/* ============================================================
   GET /cases (query)
   ============================================================ */
export const listCasesQuerySchema = z.object({
  status: z.enum(CASE_STATUSES).optional(),
  procedureType: z.enum(PROCEDURE_TYPES).optional(),
  isArchived: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => v === true || v === "true")
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  skip: z.coerce.number().int().min(0).optional(),
  sortBy: z.enum(["createdAt", "updatedAt"]).optional(),
  sortOrder: z.coerce
    .number()
    .int()
    .refine((v) => v === 1 || v === -1)
    .optional(),
});

/* ============================================================
   PATCH /cases/:caseId
   ============================================================ */
export const updateCaseSchema = z
  .object({
    status: z.enum(CASE_STATUSES).optional(),
    chiefComplaint: z.string().max(2000).optional(),
    medicalNotes: z.string().max(10000).optional(),
    plannedOperationDate: z.coerce.date().optional(),
    actualOperationDate: z.coerce.date().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

/* ============================================================
   POST /cases/:caseId/consent
   ============================================================ */
export const giveConsentSchema = z.object({
  consentDocumentUrl: z.string().url().optional(),
});

/* ============================================================
   POST /cases/:caseId/archive
   ============================================================ */
export const archiveCaseSchema = z.object({
  reason: z.string().min(1).max(500),
});

/* ============================================================
   DELETE /cases/:caseId
   ============================================================ */
export const deleteCaseSchema = z.object({
  reason: z.string().min(10).max(500),
});
