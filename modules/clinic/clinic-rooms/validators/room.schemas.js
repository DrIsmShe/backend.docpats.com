// server/modules/clinic/clinic-rooms/validators/room.schemas.js
//
// Zod schemas for ClinicRoom endpoints. Same conventions as the
// clinic-departments validators:
//   - objectIdField helper validates 24-hex strings
//   - optional-or-null fields use .nullish() so the client may send the
//     key as null (explicit clear) OR omit it entirely
//   - we never accept clinicId from the body — it comes from ALS context
//   - parse with safeParse in the controller; on failure return the
//     flattened issues so the frontend reads data.details.issues
//
// departmentId is REQUIRED on create (a room must belong to a department)
// and optional on update (you can move a room between departments, but you
// can't unset it — sending null is rejected on update via the schema).

import { z } from "zod";

const objectIdField = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "Invalid id format (24-hex ObjectId required)");

const nameField = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(200, "Name must be 200 characters or less");

const codeField = z
  .string()
  .trim()
  .max(32, "Code must be 32 characters or less")
  .transform((v) => (v === "" ? null : v.toUpperCase()));

const floorField = z
  .string()
  .trim()
  .max(50, "Floor must be 50 characters or less");

const notesField = z
  .string()
  .trim()
  .max(2000, "Notes must be 2000 characters or less");

const capacityField = z
  .number()
  .int("Capacity must be a whole number")
  .min(0, "Capacity cannot be negative")
  .max(10000, "Capacity is unreasonably large");

const statusField = z.enum(["active", "archived"]);

// Array of membership ids. Deduplicated by the service, but we cap the
// length here to avoid abuse.
const membershipIdsField = z
  .array(objectIdField)
  .max(200, "Too many assigned members");

// ─── create ───
export const createRoomSchema = z.object({
  departmentId: objectIdField,
  name: nameField,
  code: codeField.nullish(),
  floor: floorField.nullish(),
  capacity: capacityField.nullish(),
  notes: notesField.nullish(),
  assignedMembershipIds: membershipIdsField.optional(),
  status: statusField.optional(),
});

// ─── update ───
// All fields optional. departmentId, if present, must be a valid id
// (you can move a room but not orphan it — null is not allowed here).
export const updateRoomSchema = z
  .object({
    departmentId: objectIdField.optional(),
    name: nameField.optional(),
    code: codeField.nullish(),
    floor: floorField.nullish(),
    capacity: capacityField.nullish(),
    notes: notesField.nullish(),
    assignedMembershipIds: membershipIdsField.optional(),
    status: statusField.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

// ─── list query ───
export const listRoomsQuerySchema = z.object({
  departmentId: objectIdField.optional(),
  status: statusField.optional(),
});
