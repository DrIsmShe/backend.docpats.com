// server/modules/clinic/clinic-consilium/validators/consilium.schemas.js

import { z } from "zod";
import { CONSILIUM_STATUSES } from "../models/consilium.model.js";

const objectIdField = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

const titleField = z.string().trim().min(1, "title is required").max(300);
const descriptionField = z.string().max(5000).nullish();
const conclusionField = z.string().max(5000).nullish();

// ─── CREATE consilium ───
export const createConsiliumSchema = z.object({
  title: titleField,
  description: descriptionField,
  patientId: objectIdField.nullish(),
  departmentId: objectIdField.nullish(),
  participantMembershipIds: z.array(objectIdField).max(50).optional(),
  // Optional pre-authorization of the patient into the video room at creation.
  patientCanJoin: z.boolean().optional(),
});

// ─── UPDATE consilium ───
export const updateConsiliumSchema = z
  .object({
    title: titleField.optional(),
    description: descriptionField,
    patientId: objectIdField.nullish(),
    departmentId: objectIdField.nullish(),
    participantMembershipIds: z.array(objectIdField).max(50).optional(),
    status: z.enum(CONSILIUM_STATUSES).optional(),
    conclusion: conclusionField,
    // Doctor toggles the patient's access to the live video room.
    patientCanJoin: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field must be provided",
  });

// ─── LIST query ───
export const listConsiliaQuerySchema = z.object({
  status: z.enum(CONSILIUM_STATUSES).optional(),
  patientId: objectIdField.optional(),
  departmentId: objectIdField.optional(),
  participantMembershipId: objectIdField.optional(),
  q: z.string().trim().max(200).optional(),
});

// ─── CREATE message ───
export const createMessageSchema = z.object({
  text: z.string().trim().min(1, "text is required").max(20000),
});
