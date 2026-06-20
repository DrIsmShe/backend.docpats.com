// server/modules/clinic/clinic-departments/validators/department.schemas.js

import { z } from "zod";
import { DEPARTMENT_SPECIALTIES } from "../models/clinicDepartment.model.js";

// 24-hex Mongo ObjectId
const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, { message: "Invalid id" });

const specialtyEnum = z.enum(DEPARTMENT_SPECIALTIES);
const statusEnum = z.enum(["active", "archived"]);

// ── POST /clinic/departments ──────────────────────────────
export const createDepartmentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().max(32).nullish(),
  specialty: specialtyEnum.optional(), // model default: "general"
  description: z.string().trim().max(2000).optional(),
  branchId: objectId.nullish(),
  headMembershipId: objectId.nullish(),
  parentDepartmentId: objectId.nullish(),
});

// ── PATCH /clinic/departments/:id ─────────────────────────
export const updateDepartmentSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    code: z.string().trim().max(32).nullish(),
    specialty: specialtyEnum.optional(),
    description: z.string().trim().max(2000).optional(),
    branchId: objectId.nullish(),
    headMembershipId: objectId.nullish(),
    parentDepartmentId: objectId.nullish(),
    status: statusEnum.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "Empty update payload",
  });

// ── PATCH /clinic/departments/:id/head ────────────────────
export const setDepartmentHeadSchema = z.object({
  headMembershipId: objectId.nullable(), // null = снять заведующего
});

// ── GET /clinic/departments  (query) ──────────────────────
export const listDepartmentsQuerySchema = z.object({
  status: statusEnum.optional(),
  branchId: objectId.optional(),
  specialty: specialtyEnum.optional(),
  parentDepartmentId: objectId.optional(),
  q: z.string().trim().max(200).optional(), // поиск по name/code
});

// ── :id param ─────────────────────────────────────────────
export const departmentIdParamSchema = z.object({
  id: objectId,
});
