// modules/clinic/clinic-staff/validators/staff.schemas.js

import { z } from "zod";
import { ROLES } from "../../../../common/auth/permissions.js";

const ROLE_VALUES = Object.values(ROLES);
const ObjectIdRegex = /^[0-9a-fA-F]{24}$/;

export const objectIdSchema = z
  .string()
  .regex(ObjectIdRegex, "Invalid ObjectId");

/**
 * Schema for POST /staff — add existing user to clinic
 */
export const addStaffSchema = z.object({
  userId: objectIdSchema,
  role: z.enum(ROLE_VALUES),
  customTitle: z.string().trim().max(200).optional(),
  employmentType: z
    .enum(["fulltime", "parttime", "contract", "consultant"])
    .optional(),
});

/**
 * Schema for PATCH /staff/:id/role — change role
 */
export const updateRoleSchema = z.object({
  role: z.enum(ROLE_VALUES),
});

/**
 * Schema for PATCH /staff/:id — update non-role fields
 */
export const updateStaffSchema = z.object({
  customTitle: z.string().trim().max(200).optional(),
  employmentType: z
    .enum(["fulltime", "parttime", "contract", "consultant"])
    .optional(),
  isPrimary: z.boolean().optional(),
});
