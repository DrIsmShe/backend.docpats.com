// server/modules/clinic/clinic-equipment/validators/equipment.schemas.js
//
// Zod validators for ClinicEquipment endpoints. Mirrors room.schemas.js:
//   - objectIdField helper for 24-hex ObjectId strings
//   - .nullish() for optional/clearable fields
//   - departmentId required on create, NOT nullable on update (a piece of
//     equipment always belongs to a department)

import { z } from "zod";
import {
  EQUIPMENT_STATUSES,
  EQUIPMENT_CATEGORIES,
} from "../models/clinicEquipment.model.js";

const objectIdField = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

// Accept an ISO date string or a Date; transform empty string → undefined.
const dateField = z
  .union([z.string(), z.date()])
  .nullish()
  .transform((v) => {
    if (v === undefined || v === null || v === "") return undefined;
    return v;
  });

const nameField = z.string().trim().min(1, "name is required").max(200);
const shortText = z.string().trim().max(200).nullish();
const inventoryField = z.string().trim().max(64).nullish();
const notesField = z.string().trim().max(2000).nullish();

// ─── CREATE ───
export const createEquipmentSchema = z.object({
  departmentId: objectIdField,
  roomId: objectIdField.nullish(),
  name: nameField,
  inventoryNumber: inventoryField,
  category: z.enum(EQUIPMENT_CATEGORIES).optional(),
  manufacturer: shortText,
  model: shortText,
  serialNumber: shortText,
  status: z.enum(EQUIPMENT_STATUSES).optional(),
  purchaseDate: dateField,
  warrantyUntil: dateField,
  lastServiceDate: dateField,
  nextServiceDate: dateField,
  assignedMembershipIds: z.array(objectIdField).optional(),
  notes: notesField,
});

// ─── UPDATE ───
// departmentId, if present, must be a valid id (NOT null — equipment always
// belongs to a department). roomId may be set to null to detach.
export const updateEquipmentSchema = z
  .object({
    departmentId: objectIdField.optional(),
    roomId: objectIdField.nullish(),
    name: nameField.optional(),
    inventoryNumber: inventoryField,
    category: z.enum(EQUIPMENT_CATEGORIES).optional(),
    manufacturer: shortText,
    model: shortText,
    serialNumber: shortText,
    status: z.enum(EQUIPMENT_STATUSES).optional(),
    purchaseDate: dateField,
    warrantyUntil: dateField,
    lastServiceDate: dateField,
    nextServiceDate: dateField,
    assignedMembershipIds: z.array(objectIdField).optional(),
    notes: notesField,
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

// ─── LIST QUERY ───
export const listEquipmentQuerySchema = z.object({
  departmentId: objectIdField.optional(),
  roomId: objectIdField.optional(),
  category: z.enum(EQUIPMENT_CATEGORIES).optional(),
  status: z.enum(EQUIPMENT_STATUSES).optional(),
  q: z.string().trim().max(200).optional(),
});
