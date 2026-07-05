// modules/clinic/clinic-staff/validators/invitation.schemas.js

import { z } from "zod";
import { ROLES } from "../../../../common/auth/permissions.js";

const ROLE_VALUES = Object.values(ROLES);
const INTERNAL_ROLES = ROLE_VALUES.filter(
  (r) => !["owner", "doctor", "patient"].includes(r),
);

// Internal staff roles (those who get ClinicEmployee account, not User account)
const INTERNAL_INVITE_ROLES = [
  "manager",
  "nurse",
  "receptionist",
  "accountant",
  "pharmacist",
  "marketer",
];

const SUPPORTED_LANGUAGES = ["ru", "en", "tr", "az", "ar"];

// Token format: alphanumeric + dots + dashes + underscores (signed URL token from common/utils/signedUrl.js)
const TOKEN_REGEX = /^[A-Za-z0-9._-]+$/;

export const createInvitationSchema = z.object({
  email: z.string().email().max(254),
  role: z.enum(INTERNAL_INVITE_ROLES),
  customTitle: z.string().trim().max(200).optional(),
  language: z.enum(SUPPORTED_LANGUAGES).optional().default("ru"),
});

export const previewTokenSchema = z.object({
  token: z.string().regex(TOKEN_REGEX).min(20).max(2000),
});

export const requestOtpSchema = z.object({
  token: z.string().regex(TOKEN_REGEX).min(20).max(2000),
});

export const acceptInvitationSchema = z.object({
  token: z.string().regex(TOKEN_REGEX).min(20).max(2000),
  otp: z.string().regex(/^\d{6}$/, "OTP must be 6 digits"),
  password: z.string().min(8).max(200),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  phoneNumber: z
    .string()
    .trim()
    .regex(/^\+?[0-9\s\-()]{6,30}$/, "Invalid phone number")
    .optional(),
  language: z.enum(SUPPORTED_LANGUAGES).optional().default("ru"),
});
