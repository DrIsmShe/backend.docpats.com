// modules/clinic/clinic-staff/services/searchDoctors.service.js
//
// Search existing DocPats Users (doctors) for adding to clinic staff.
// Decrypts PII server-side and filters in memory (MVP approach).

import User, { decrypt } from "../../../../common/models/Auth/users.js";
import ClinicMembership from "../models/clinicMembership.model.js";
import { getCurrentClinicId } from "../../../../common/context/tenantContext.js";
import {
  ForbiddenError,
  ValidationError,
} from "../../../../common/utils/errors.js";
import logger from "../../../../common/logger.js";

const log = logger.child({ module: "clinic-staff/search-doctors" });

const MIN_QUERY_LENGTH = 2;
const MAX_RESULTS = 20;

/**
 * Safely decrypt a field, returning empty string on failure.
 */
function safeDecrypt(encryptedValue) {
  if (!encryptedValue) return "";
  try {
    return decrypt(encryptedValue) || "";
  } catch {
    return "";
  }
}

/**
 * Search doctors by name or email.
 *
 * @param {string} query — substring to match (case-insensitive)
 * @returns {Promise<Array>} — list of doctor profiles for UI
 */
export async function searchDoctors(query) {
  const clinicId = getCurrentClinicId();
  if (!clinicId) {
    throw new ForbiddenError("No active clinic context");
  }

  const q = (query || "").trim().toLowerCase();
  if (q.length < MIN_QUERY_LENGTH) {
    throw new ValidationError(
      `Query must be at least ${MIN_QUERY_LENGTH} characters`,
      { field: "q" },
    );
  }

  // 1. Find user IDs already in this clinic (active memberships)
  //    so we can exclude them from results
  const existingMemberships = await ClinicMembership.find({
    clinicId,
    leftAt: null,
  })
    .select("userId")
    .lean();
  const existingUserIds = new Set(
    existingMemberships.map((m) => String(m.userId)),
  );

  // 2. Fetch candidate doctors from User collection
  //    (this is NOT tenant-scoped — User is a global resource)
  const candidates = await User.find({
    isDoctor: true,
    isBlocked: { $ne: true },
  })
    .select(
      "_id firstNameEncrypted lastNameEncrypted emailEncrypted username role avatar verification createdAt",
    )
    .limit(500) // upper bound to prevent OOM
    .lean();

  // 3. Decrypt and filter in memory
  const results = [];
  for (const u of candidates) {
    if (existingUserIds.has(String(u._id))) continue;

    const firstName = safeDecrypt(u.firstNameEncrypted);
    const lastName = safeDecrypt(u.lastNameEncrypted);
    const email = safeDecrypt(u.emailEncrypted);

    const haystack =
      `${firstName} ${lastName} ${email} ${u.username || ""}`.toLowerCase();
    if (!haystack.includes(q)) continue;

    results.push({
      userId: String(u._id),
      firstName,
      lastName,
      email,
      username: u.username,
      avatar: u.avatar || null,
      isVerified: u.verification?.status === "verified",
      verificationLevel: u.verification?.level || "unverified",
    });

    if (results.length >= MAX_RESULTS) break;
  }

  log.info(
    { query: q, found: results.length, clinicId: String(clinicId) },
    "Doctor search completed",
  );

  return results;
}
