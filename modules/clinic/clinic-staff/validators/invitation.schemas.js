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

// ────────────────────────────────────────────────────────────────────────────
// MEMBERSHIP INVITE (User-backed member, e.g. admin "near-owner")
//
// Distinct from the employee invite above. An admin is a DocPats User with a
// ClinicMembership (actorType "user"), NEVER a ClinicEmployee. There is no OTP:
// the invite token itself is the proof (accept variant 2 — strict token
// binding, then assert user.email === invite.email).
//
// Two acceptance paths:
//   - Existing DocPats User -> authenticated accept: { token } only.
//   - New person          -> registration carries the token; membership is
//     created right after the User is created (see membershipInviteRegistrationSchema).
// ────────────────────────────────────────────────────────────────────────────

// Which roles may be granted via a User-backed membership invite.
// Policy lives here; the model stays generic. Extend cautiously.
export const MEMBERSHIP_INVITE_ROLES = ["admin"];

export const createMembershipInvitationSchema = z.object({
  email: z.string().email().max(254),
  role: z.enum(MEMBERSHIP_INVITE_ROLES).optional().default("admin"),
  customTitle: z.string().trim().max(200).optional(),
  language: z.enum(SUPPORTED_LANGUAGES).optional().default("ru"),
});

// Render the accept page (clinic name, role, invited email) before acting.
export const previewMembershipTokenSchema = z.object({
  token: z.string().regex(TOKEN_REGEX).min(20).max(2000),
});

// Authenticated existing User accepts the invite. Session provides identity;
// service asserts session user's email === invite.email.
export const acceptMembershipInvitationSchema = z.object({
  token: z.string().regex(TOKEN_REGEX).min(20).max(2000),
});

// New person registers through the invite link (?invite=<token>). Mirrors the
// User registration payload; no OTP. Compose/merge into the User registration
// controller — after User.create(), the service creates the membership bound to
// this token, asserting the registered email matches invite.email.
export const membershipInviteRegistrationSchema = z.object({
  token: z.string().regex(TOKEN_REGEX).min(20).max(2000),
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

// For GET / revoke by invite id (owner UI).
export const membershipInviteIdParamSchema = z.object({
  inviteId: z.string().regex(/^[a-f\d]{24}$/i, "Invalid invite id"),
});
