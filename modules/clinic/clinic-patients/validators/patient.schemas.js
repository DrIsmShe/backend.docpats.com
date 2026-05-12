// server/modules/clinic/clinic-patients/validators/patient.schemas.js
//
// zod schemas for ClinicPatient REST endpoints.
//
// Patient PII is stored encrypted, but validation happens BEFORE encryption,
// so we still apply normal length/format constraints to plaintext input.

import { z } from "zod";

// ─── Field-level building blocks ──────────────────────────────────────

// Names — trimmed, min 1 max 100. Allow unicode (international names).
const nameField = z
  .string()
  .trim()
  .min(1, "Name must not be empty")
  .max(100, "Name must be 100 characters or less");

// Phone — relaxed format. We don't enforce E.164 here because:
//   1. Clinics may have local-format numbers (no country code)
//   2. Normalization happens before hashing in the service layer
// We only reject obvious junk: must contain at least 5 digits.
const phoneField = z
  .string()
  .trim()
  .max(40, "Phone must be 40 characters or less")
  .refine(
    (v) => (v.match(/\d/g) || []).length >= 5,
    "Phone must contain at least 5 digits",
  );

// Email — basic shape check. Stored encrypted regardless.
const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .email("Invalid email format")
  .max(254, "Email too long"); // RFC 5321 limit

// Date of birth — accepts ISO string OR Date. Rejects future dates and
// absurdly old (> 130 years ago, beyond any plausible patient).
const dobField = z
  .union([z.string(), z.date()])
  .transform((v) => (v instanceof Date ? v : new Date(v)))
  .refine((d) => !isNaN(d.getTime()), "Invalid date")
  .refine((d) => d <= new Date(), "Date of birth cannot be in the future")
  .refine((d) => {
    const minDate = new Date();
    minDate.setFullYear(minDate.getFullYear() - 130);
    return d >= minDate;
  }, "Date of birth too far in the past");

const genderField = z.enum(["male", "female", "other", "unknown"]);

// Notes — long-form clinical/admin comments. Capped at 5K chars.
const notesField = z
  .string()
  .trim()
  .max(5000, "Notes must be 5000 characters or less");

// MongoDB ObjectId — 24 hex chars
const objectIdField = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId");

// ─── createPatientSchema ──────────────────────────────────────────────

export const createPatientSchema = z.object({
  firstName: nameField,
  lastName: nameField,
  phone: phoneField.optional().nullable(),
  email: emailField.optional().nullable(),
  dateOfBirth: dobField.optional().nullable(),
  gender: genderField.optional().nullable(),
  notes: notesField.optional().nullable(),
  // linkedUserId is set via separate endpoint (POST /:id/link), not on create
});

// ─── updatePatientSchema ──────────────────────────────────────────────
//
// All fields optional — partial updates. Empty object is rejected to avoid
// pointless PATCH requests.

export const updatePatientSchema = z
  .object({
    firstName: nameField.optional(),
    lastName: nameField.optional(),
    phone: phoneField.nullable().optional(),
    email: emailField.nullable().optional(),
    dateOfBirth: dobField.nullable().optional(),
    gender: genderField.nullable().optional(),
    notes: notesField.nullable().optional(),
  })
  .refine(
    (obj) => Object.keys(obj).length > 0,
    "At least one field must be provided",
  );

// ─── searchPatientsSchema ─────────────────────────────────────────────
//
// Search is a GET so input comes from req.query (strings only).
// Either `phone` OR `lastName` OR `email` must be provided.

export const searchPatientsSchema = z
  .object({
    phone: z.string().trim().max(40).optional(),
    email: z.string().trim().toLowerCase().max(254).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  })
  .refine(
    (q) => q.phone || q.email || q.lastName,
    "At least one search criterion (phone, email, or lastName) is required",
  );

// ─── listPatientsSchema ──────────────────────────────────────────────
//
// Pagination for GET /patients.
// Cursor-based via `before` (createdAt of last item from previous page).

export const listPatientsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  before: z
    .union([z.string(), z.date()])
    .optional()
    .transform((v) => (v ? new Date(v) : undefined))
    .refine(
      (d) => d === undefined || !isNaN(d.getTime()),
      "Invalid `before` date",
    ),
  sortBy: z
    .enum(["createdAt", "lastVisitAt", "lastName"])
    .optional()
    .default("createdAt"),
  includeLinked: z.coerce.boolean().optional().default(false),
});

// ─── linkPatientSchema ────────────────────────────────────────────────
//
// Links an existing ClinicPatient record to a DocPats User account.

export const linkPatientSchema = z.object({
  userId: objectIdField,
});

// ─── paramSchemas ────────────────────────────────────────────────────

export const patientIdParamSchema = z.object({
  id: objectIdField,
});
