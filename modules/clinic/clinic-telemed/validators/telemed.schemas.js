// server/modules/clinic/clinic-telemed/validators/telemed.schemas.js

import { z } from "zod";
import { TELEMED_STATUSES } from "../models/telemedSession.model.js";

const objectIdField = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

// ISO string or Date; "" → undefined.
const dateField = z
  .union([z.string(), z.date()])
  .nullish()
  .transform((v) => {
    if (v === undefined || v === null || v === "") return undefined;
    return v;
  });

const titleField = z.string().trim().min(1, "title is required").max(300);
const notesField = z.string().trim().max(2000).nullish();
const durationField = z.coerce.number().int().min(5).max(480).optional();

// http/https URL, or null/empty to clear.
const meetingUrlField = z
  .string()
  .trim()
  .max(1000)
  .url("meetingUrl must be a valid URL")
  .refine((u) => /^https?:\/\//i.test(u), {
    message: "meetingUrl must start with http:// or https://",
  })
  .nullish();

// ─── CREATE ───
export const createSessionSchema = z.object({
  title: titleField,
  scheduledAt: z
    .union([z.string(), z.date()])
    .refine((v) => v !== undefined && v !== null && v !== "", {
      message: "scheduledAt is required",
    }),
  patientId: objectIdField.nullish(),
  patientUserId: objectIdField.nullish(),
  hostMembershipId: objectIdField.nullish(),
  departmentId: objectIdField.nullish(),
  durationMinutes: durationField,
  meetingUrl: meetingUrlField,
  notes: notesField,
});

// ─── UPDATE ───
export const updateSessionSchema = z
  .object({
    title: titleField.optional(),
    scheduledAt: dateField,
    patientId: objectIdField.nullish(),
    patientUserId: objectIdField.nullish(),
    hostMembershipId: objectIdField.nullish(),
    departmentId: objectIdField.nullish(),
    durationMinutes: durationField,
    status: z.enum(TELEMED_STATUSES).optional(),
    meetingUrl: meetingUrlField,
    notes: notesField,
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field must be provided",
  });

// ─── LIST QUERY ───
export const listSessionsQuerySchema = z.object({
  status: z.enum(TELEMED_STATUSES).optional(),
  patientId: objectIdField.optional(),
  hostMembershipId: objectIdField.optional(),
  departmentId: objectIdField.optional(),
  from: z.union([z.string(), z.date()]).optional(),
  to: z.union([z.string(), z.date()]).optional(),
  q: z.string().trim().max(200).optional(),
});
