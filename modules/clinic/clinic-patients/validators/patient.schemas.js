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

export const createPatientSchema = z
  .object({
    firstName: nameField,
    lastName: nameField,
    phone: phoneField.optional().nullable(),
    email: emailField.optional().nullable(),
    dateOfBirth: dobField.optional().nullable(),
    gender: genderField.optional().nullable(),
    notes: notesField.optional().nullable(),
    // linkedUserId is set via separate endpoint (POST /:id/link), not on create

    // Provisional User flag (v2, May 2026):
    // When true, the service ALSO creates a temporary DocPats User
    // account with tmp email + password, links it to this ClinicPatient,
    // and returns the credentials in the response (one time only).
    // The patient receives a printed/PDF card with these credentials and
    // can log in within 3 years to activate.
    createProvisionalUser: z.boolean().optional().default(false),

    // Cross-clinic dedup consent flag (22 May 2026):
    // When the patient's email matches an existing DocPats User account
    // (either active or another clinic's provisional), the service refuses
    // to create/link until the receptionist explicitly confirms that the
    // patient gave consent. UI shows a modal with the found user's name +
    // DOB; receptionist ticks "пациент дал согласие" and resubmits with
    // this flag set to true.
    //
    // Why a boolean here rather than a separate endpoint:
    //   1. Frontend already has the full payload from Step 2 — resubmitting
    //      the same body + one extra flag is simpler than POSTing twice.
    //   2. Service-layer logic can decide what to DO with consent based on
    //      what the existing user is — active = link, provisional = reissue.
    //      One endpoint, one happy path, no race between two requests.
    patientConsentConfirmed: z.boolean().optional().default(false),
  })
  .refine(
    // If createProvisionalUser is true, dateOfBirth is REQUIRED.
    // User model requires dateOfBirth, and we don't want to invent a fake
    // value just to satisfy the schema — the clinic should know the DOB.
    (data) => {
      if (data.createProvisionalUser && !data.dateOfBirth) return false;
      return true;
    },
    {
      message: "dateOfBirth is required when createProvisionalUser is true",
      path: ["dateOfBirth"],
    },
  );

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

// ─── searchUsersSchema ────────────────────────────────────────────────
//
// Search DocPats User accounts to link a patient to. GET endpoint, so
// input comes from req.query (strings only).
//
// Two mutually exclusive modes:
//   mode "email" — `email` is required. Exact-match via emailHash.
//   mode "dob"   — `dateOfBirth` is required (YYYY-MM-DD). firstName and
//                  lastName are optional name filters applied on top.
//
// Note: we keep email/dateOfBirth as loose trimmed strings here (not the
// strict emailField / dobField used for patient records). The service
// layer normalizes and validates them — and for SEARCH we want to be
// forgiving: a slightly-off query should return empty results, not a
// 400. Strict rejection only on missing required field per mode.

export const searchUsersSchema = z
  .object({
    mode: z.enum(["email", "dob"]),
    email: z.string().trim().max(254).optional(),
    dateOfBirth: z.string().trim().max(40).optional(),
    firstName: z.string().trim().max(100).optional(),
    lastName: z.string().trim().max(100).optional(),
  })
  .refine(
    (q) => {
      if (q.mode === "email") return !!q.email;
      if (q.mode === "dob") return !!q.dateOfBirth;
      return false;
    },
    {
      message: "mode=email requires `email`; mode=dob requires `dateOfBirth`",
    },
  );

// ─── paramSchemas ────────────────────────────────────────────────────

export const patientIdParamSchema = z.object({
  id: objectIdField,
});
