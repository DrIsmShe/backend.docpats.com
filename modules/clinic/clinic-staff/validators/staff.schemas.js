// modules/clinic/clinic-staff/validators/staff.schemas.js

import { z } from "zod";
import { ROLES } from "../../../../common/auth/permissions.js";

const ROLE_VALUES = Object.values(ROLES);
const ObjectIdRegex = /^[0-9a-fA-F]{24}$/;

export const objectIdSchema = z
  .string()
  .regex(ObjectIdRegex, "Invalid ObjectId");

export const addStaffSchema = z.object({
  userId: objectIdSchema,
  role: z.enum(ROLE_VALUES),
  customTitle: z.string().trim().max(200).optional(),
  employmentType: z
    .enum(["fulltime", "parttime", "contract", "consultant"])
    .optional(),
});

export const updateRoleSchema = z.object({
  role: z.enum(ROLE_VALUES),
});

export const updateStaffSchema = z.object({
  customTitle: z.string().trim().max(200).optional(),
  employmentType: z
    .enum(["fulltime", "parttime", "contract", "consultant"])
    .optional(),
  isPrimary: z.boolean().optional(),
});
