// server/modules/auth/validators/completeProvisional.schema.js

import { z } from "zod";

// STEP 1 — request OTP
export const requestOtpSchema = z.object({
  newEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email("Invalid email format")
    .max(254, "Email too long"),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(200, "Password too long"),
});

// STEP 2 — confirm OTP
export const confirmOtpSchema = z.object({
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "OTP must be exactly 6 digits"),
});

// Legacy schema kept exported for any external imports — same as
// requestOtpSchema. Can be deleted once we confirm nothing imports it.
export const completeProvisionalSchema = requestOtpSchema;
