// server/modules/clinic/clinic-patients/services/patient.service.js
//
// Business logic for ClinicPatient CRUD + search.
//
// Architecture decisions:
//   1. All queries rely on tenantScoped plugin — clinicId is auto-filtered.
//      We never pass clinicId manually; we read it from tenantContext for
//      validation and event emission only.
//   2. PHI fields are encrypted via model's encryptValue() at write time.
//      Reads always go through .lean() + manual decrypt because virtuals
//      don't fire on lean queries.
//   3. Search by phone/email uses blind-index (phoneHash/emailHash) for
//      O(log n) exact match. Search by lastName decrypts ALL matching
//      clinic patients and filters in-memory — acceptable up to ~5K
//      patients per clinic. Beyond that we'd need a different strategy.
//   4. Service functions throw typed errors; controller catches them.
//      Permissions are checked via require() — fail fast.
//   5. List/Detail/Search responses include `createdByName` — actor's
//      display name resolved via bulk fetch + decrypt from User or
//      ClinicEmployee depending on createdByType. Skipped on write
//      paths (create/update/link) where the actor is the caller itself.

import ClinicPatient, {
  encryptValue,
  decryptValue,
  hashValue,
} from "../models/clinicPatient.model.js";
import { eventBus, EVENTS } from "../../../../common/events/eventBus.js";
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
  UnprocessableError,
} from "../../../../common/utils/errors.js";
import {
  getCurrentClinicId,
  getCurrentUserId,
  getCurrentActorType,
} from "../../../../common/context/tenantContext.js";
import { require as requirePerm } from "../../../../common/auth/can.js";
import logger from "../../../../common/logger.js";

const log = logger.child({ module: "clinic-patients/service" });

// ─── helpers ──────────────────────────────────────────────────────────

function requireClinicId() {
  const clinicId = getCurrentClinicId();
  if (!clinicId) throw new ForbiddenError("No active clinic context");
  return clinicId;
}

function requireActor() {
  const userId = getCurrentUserId();
  const actorType = getCurrentActorType();
  if (!userId || !actorType) {
    throw new ForbiddenError("Authenticated actor required");
  }
  return { userId, actorType };
}

/**
 * Normalize phone for hashing/comparison.
 * Strips everything except digits and the leading "+".
 * "+994 50 123-45-67" → "+994501234567"
 * "050 123 45 67"     → "0501234567"
 *
 * NOTE: this means "+994501234567" and "0501234567" hash to DIFFERENT
 * values. We don't attempt country-code inference here — it's the
 * clinic's responsibility to be consistent in their data entry, and
 * we expose the raw normalized form to search so users get what they
 * type.
 */
function normalizePhone(phone) {
  if (!phone) return null;
  const hasPlus = String(phone).trim().startsWith("+");
  const digits = String(phone).replace(/\D/g, "");
  if (!digits) return null;
  return hasPlus ? `+${digits}` : digits;
}

/**
 * Convert lean document into API response shape:
 *   - decrypt PHI fields
 *   - strip encrypted/hash fields
 *   - keep audit + demographic fields as-is
 *   - includes `createdByName` if previously enriched via
 *     enrichWithCreatedByName (otherwise null)
 *
 * NEVER returns raw encrypted blobs to callers.
 */
function toApiShape(doc) {
  if (!doc) return null;
  return {
    _id: String(doc._id),
    clinicId: String(doc.clinicId),
    firstName: decryptValue(doc.firstNameEncrypted),
    lastName: decryptValue(doc.lastNameEncrypted),
    phone: decryptValue(doc.phoneEncrypted),
    email: decryptValue(doc.emailEncrypted),
    notes: decryptValue(doc.notesEncrypted),
    dateOfBirth: doc.dateOfBirth || null,
    gender: doc.gender || null,
    linkedUserId: doc.linkedUserId ? String(doc.linkedUserId) : null,
    createdBy: doc.createdBy ? String(doc.createdBy) : null,
    createdByType: doc.createdByType,
    createdByName: doc.createdByName || null,
    lastUpdatedBy: doc.lastUpdatedBy ? String(doc.lastUpdatedBy) : null,
    lastVisitAt: doc.lastVisitAt || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

// ─── createdBy name resolver ─────────────────────────────────────────
//
// For a batch of patient docs, fetch the actor's name from User or
// ClinicEmployee collection (depending on createdByType) and merge it
// into the doc as `createdByName`. Uses two parallel bulk queries.

async function enrichWithCreatedByName(docs) {
  if (!docs || docs.length === 0) return docs;

  // Split createdBy IDs by actor type (skip null/missing)
  const userIds = [];
  const employeeIds = [];
  for (const d of docs) {
    if (!d.createdBy) continue;
    if (d.createdByType === "employee") {
      employeeIds.push(d.createdBy);
    } else {
      userIds.push(d.createdBy);
    }
  }

  if (userIds.length === 0 && employeeIds.length === 0) return docs;

  // Lazy import — same pattern as in linkToUser, avoids circular deps
  const User = (await import("../../../../common/models/Auth/users.js"))
    .default;
  const ClinicEmployee = (
    await import("../../clinic-staff/models/clinicEmployee.model.js")
  ).default;

  const [users, employees] = await Promise.all([
    userIds.length
      ? User.find({ _id: { $in: userIds } })
          .select("_id firstNameEncrypted lastNameEncrypted username")
          .lean()
      : Promise.resolve([]),
    employeeIds.length
      ? ClinicEmployee.find({ _id: { $in: employeeIds } })
          .select("_id firstNameEncrypted lastNameEncrypted")
          .lean()
      : Promise.resolve([]),
  ]);

  // Import decrypt helpers
  const { decrypt: decryptUser } =
    await import("../../../../common/models/Auth/users.js");
  const { decryptValue: decryptEmployee } =
    await import("../../clinic-staff/models/clinicEmployee.model.js");

  const safeDecrypt = (fn, value) => {
    if (!value) return null;
    try {
      return fn(value) || null;
    } catch {
      return null;
    }
  };

  // Build name maps for O(1) lookup
  const userNames = new Map(
    users.map((u) => {
      const fn = safeDecrypt(decryptUser, u.firstNameEncrypted);
      const ln = safeDecrypt(decryptUser, u.lastNameEncrypted);
      const name = [fn, ln].filter(Boolean).join(" ") || u.username || null;
      return [String(u._id), name];
    }),
  );
  const employeeNames = new Map(
    employees.map((e) => {
      const fn = safeDecrypt(decryptEmployee, e.firstNameEncrypted);
      const ln = safeDecrypt(decryptEmployee, e.lastNameEncrypted);
      const name = [fn, ln].filter(Boolean).join(" ") || null;
      return [String(e._id), name];
    }),
  );

  // Merge name into each doc
  return docs.map((d) => {
    if (!d.createdBy) return d;
    const idStr = String(d.createdBy);
    const name =
      d.createdByType === "employee"
        ? employeeNames.get(idStr)
        : userNames.get(idStr);
    return { ...d, createdByName: name || null };
  });
}

// ─── createPatient ────────────────────────────────────────────────────

export async function createPatient(input) {
  requirePerm("patient", "write");
  const clinicId = requireClinicId();
  const { userId, actorType } = requireActor();

  // Normalize phone/email BEFORE encrypting so hash matches future searches
  const normalizedPhone = normalizePhone(input.phone);
  const normalizedEmail = input.email ? input.email.trim().toLowerCase() : null;

  // Optional duplicate check: same phone within the same clinic
  if (normalizedPhone) {
    const phoneHash = hashValue(normalizedPhone);
    const dup = await ClinicPatient.findOne({ phoneHash }).lean();
    if (dup) {
      throw new ConflictError("Patient with this phone already exists", {
        existingPatientId: String(dup._id),
      });
    }
  }

  const doc = await ClinicPatient.create({
    clinicId, // tenantScoped plugin will also enforce this on writes
    firstNameEncrypted: encryptValue(input.firstName),
    lastNameEncrypted: encryptValue(input.lastName),
    phoneEncrypted: normalizedPhone ? encryptValue(normalizedPhone) : null,
    emailEncrypted: normalizedEmail ? encryptValue(normalizedEmail) : null,
    phoneHash: normalizedPhone ? hashValue(normalizedPhone) : null,
    emailHash: normalizedEmail ? hashValue(normalizedEmail) : null,
    dateOfBirth: input.dateOfBirth || null,
    gender: input.gender || null,
    notesEncrypted: input.notes ? encryptValue(input.notes) : null,
    createdBy: userId,
    createdByType: actorType,
  });

  log.info(
    { patientId: String(doc._id), clinicId: String(clinicId) },
    "Patient created",
  );

  eventBus.emitSafe(EVENTS.PATIENT_CREATED, {
    patientId: String(doc._id),
    clinicId: String(clinicId),
    createdBy: String(userId),
    createdByType: actorType,
  });

  // Return decrypted shape; doc.toObject() would also work but lean is
  // consistent with the rest of the service (and faster).
  return toApiShape(doc.toObject());
}

// ─── listPatients ─────────────────────────────────────────────────────
//
// Cursor-based pagination. `before` is a Date from the previous page's
// last item. `sortBy` determines both the sort key AND the cursor field
// (cursor must match sort to be deterministic).

export async function listPatients(query = {}) {
  requirePerm("patient", "read");
  requireClinicId(); // tenantScoped handles filter

  const {
    limit = 50,
    before,
    sortBy = "createdAt",
    includeLinked = false,
  } = query;

  const filter = {};
  if (before) {
    filter[sortBy] = { $lt: before };
  }
  if (includeLinked === false) {
    // omit: include both linked and unlinked
  }

  const sort = { [sortBy]: -1, _id: -1 };

  const items = await ClinicPatient.find(filter)
    .sort(sort)
    .limit(Math.min(limit, 100))
    .lean();

  const enriched = await enrichWithCreatedByName(items);
  const result = enriched.map(toApiShape);

  // Next-page cursor: last item's sortBy field. Client passes this back as `before`.
  const nextCursor =
    items.length === limit && items[items.length - 1]
      ? items[items.length - 1][sortBy]
      : null;

  return { items: result, nextCursor, count: result.length };
}

// ─── getPatientById ───────────────────────────────────────────────────

export async function getPatientById(id) {
  requirePerm("patient", "read");
  requireClinicId();

  const doc = await ClinicPatient.findById(id).lean();
  if (!doc) throw new NotFoundError("Patient");
  const [enriched] = await enrichWithCreatedByName([doc]);
  return toApiShape(enriched);
}

// ─── updatePatient ────────────────────────────────────────────────────
//
// Partial update. Only fields present in `input` are touched.
// For PHI fields we re-encrypt; phone/email re-hash.
// Setting phone/email/notes to null explicitly clears them.

export async function updatePatient(id, input) {
  requirePerm("patient", "write");
  requireClinicId();
  const { userId } = requireActor();

  const existing = await ClinicPatient.findById(id);
  if (!existing) throw new NotFoundError("Patient");

  // Map plaintext input → encrypted/hashed model fields
  const update = { lastUpdatedBy: userId };

  if (Object.prototype.hasOwnProperty.call(input, "firstName")) {
    update.firstNameEncrypted = encryptValue(input.firstName);
  }
  if (Object.prototype.hasOwnProperty.call(input, "lastName")) {
    update.lastNameEncrypted = encryptValue(input.lastName);
  }
  if (Object.prototype.hasOwnProperty.call(input, "phone")) {
    const normalized = normalizePhone(input.phone);

    // Duplicate check: another patient in this clinic with same phone
    if (normalized) {
      const newHash = hashValue(normalized);
      if (newHash !== existing.phoneHash) {
        const dup = await ClinicPatient.findOne({
          phoneHash: newHash,
          _id: { $ne: existing._id },
        }).lean();
        if (dup) {
          throw new ConflictError("Another patient already uses this phone", {
            existingPatientId: String(dup._id),
          });
        }
      }
      update.phoneEncrypted = encryptValue(normalized);
      update.phoneHash = newHash;
    } else {
      update.phoneEncrypted = null;
      update.phoneHash = null;
    }
  }
  if (Object.prototype.hasOwnProperty.call(input, "email")) {
    const normalized = input.email ? input.email.trim().toLowerCase() : null;
    if (normalized) {
      update.emailEncrypted = encryptValue(normalized);
      update.emailHash = hashValue(normalized);
    } else {
      update.emailEncrypted = null;
      update.emailHash = null;
    }
  }
  if (Object.prototype.hasOwnProperty.call(input, "notes")) {
    update.notesEncrypted = input.notes ? encryptValue(input.notes) : null;
  }
  if (Object.prototype.hasOwnProperty.call(input, "dateOfBirth")) {
    update.dateOfBirth = input.dateOfBirth || null;
  }
  if (Object.prototype.hasOwnProperty.call(input, "gender")) {
    update.gender = input.gender || null;
  }

  // Apply update — relies on tenantScoped plugin to enforce clinicId
  const updated = await ClinicPatient.findByIdAndUpdate(id, update, {
    new: true,
  }).lean();

  if (!updated) throw new NotFoundError("Patient");

  log.info(
    {
      patientId: String(updated._id),
      fields: Object.keys(input),
      updatedBy: String(userId),
    },
    "Patient updated",
  );

  eventBus.emitSafe(EVENTS.PATIENT_UPDATED, {
    patientId: String(updated._id),
    clinicId: String(updated.clinicId),
    updatedBy: String(userId),
    fields: Object.keys(input),
  });

  return toApiShape(updated);
}

// ─── deletePatient (soft) ─────────────────────────────────────────────

export async function deletePatient(id) {
  requirePerm("patient", "delete");
  requireClinicId();
  const { userId } = requireActor();

  // softDelete plugin provides this method on the model
  const existing = await ClinicPatient.findById(id);
  if (!existing) throw new NotFoundError("Patient");

  // Use plugin's soft-delete; passes the actor for audit
  if (typeof existing.softDelete === "function") {
    await existing.softDelete(userId);
  } else {
    // Fallback if plugin signature differs — direct field set
    existing.isDeleted = true;
    existing.deletedAt = new Date();
    existing.deletedBy = userId;
    await existing.save();
  }

  log.info(
    { patientId: String(id), deletedBy: String(userId) },
    "Patient soft-deleted",
  );

  eventBus.emitSafe(EVENTS.PATIENT_DELETED, {
    patientId: String(id),
    clinicId: String(existing.clinicId),
    deletedBy: String(userId),
  });

  return { patientId: String(id), deleted: true };
}

// ─── searchPatients ───────────────────────────────────────────────────
//
// Three modes (can combine):
//   - phone:    O(1) via phoneHash blind index
//   - email:    O(1) via emailHash blind index
//   - lastName: O(N) — decrypt every clinic patient and prefix-match in
//               memory. Bounded by `limit` and capped at 500 scanned
//               records to prevent abuse.

const LAST_NAME_SCAN_CAP = 500;

export async function searchPatients(query) {
  requirePerm("patient", "read");
  requireClinicId();

  const { phone, email, lastName, limit = 20 } = query;

  // Exact-match paths first (cheap, indexed)
  const orClauses = [];
  if (phone) {
    const normalized = normalizePhone(phone);
    if (normalized) orClauses.push({ phoneHash: hashValue(normalized) });
  }
  if (email) {
    const normalized = email.trim().toLowerCase();
    orClauses.push({ emailHash: hashValue(normalized) });
  }

  let exactMatches = [];
  if (orClauses.length > 0) {
    exactMatches = await ClinicPatient.find({ $or: orClauses })
      .limit(limit)
      .lean();
  }

  // Last-name prefix path (expensive, decrypt-then-filter)
  let nameMatches = [];
  if (lastName) {
    const needle = lastName.trim().toLowerCase();
    // Scan up to LAST_NAME_SCAN_CAP records. Bias toward recent patients
    // (createdAt DESC) so newly-added are findable instantly.
    const candidates = await ClinicPatient.find()
      .select(
        "_id clinicId firstNameEncrypted lastNameEncrypted phoneEncrypted emailEncrypted dateOfBirth gender linkedUserId createdAt updatedAt createdBy createdByType lastVisitAt",
      )
      .sort({ createdAt: -1 })
      .limit(LAST_NAME_SCAN_CAP)
      .lean();

    nameMatches = candidates.filter((doc) => {
      const ln = decryptValue(doc.lastNameEncrypted);
      if (!ln) return false;
      return ln.toLowerCase().startsWith(needle);
    });

    if (nameMatches.length > limit) {
      nameMatches = nameMatches.slice(0, limit);
    }
  }

  // De-duplicate by _id (a patient could match both phone AND lastName)
  const seen = new Set();
  const deduped = [];
  for (const doc of [...exactMatches, ...nameMatches]) {
    const id = String(doc._id);
    if (seen.has(id)) continue;
    seen.add(id);
    deduped.push(doc);
    if (deduped.length >= limit) break;
  }

  const enriched = await enrichWithCreatedByName(deduped);
  const merged = enriched.map(toApiShape);

  return { items: merged, count: merged.length };
}

// ─── linkToUser ───────────────────────────────────────────────────────
//
// Connects this ClinicPatient record to an existing DocPats User account.
// Idempotent: linking the same user twice is fine.
// Re-linking to a different user requires explicit unlink first
// (we throw ConflictError to force a deliberate action).

export async function linkToUser(id, userId) {
  requirePerm("patient", "write");
  requireClinicId();
  const { userId: actorId } = requireActor();

  const patient = await ClinicPatient.findById(id);
  if (!patient) throw new NotFoundError("Patient");

  if (patient.linkedUserId) {
    if (String(patient.linkedUserId) === String(userId)) {
      // No-op: already linked to this user
      return toApiShape(patient.toObject());
    }
    throw new ConflictError(
      "Patient is already linked to a different user. Unlink first.",
      { currentLinkedUserId: String(patient.linkedUserId) },
    );
  }

  // Lazy import User to avoid circular dependency with auth module
  const User = (await import("../../../../common/models/Auth/users.js"))
    .default;
  const userExists = await User.exists({ _id: userId });
  if (!userExists) {
    throw new UnprocessableError("Target user does not exist");
  }

  patient.linkedUserId = userId;
  patient.lastUpdatedBy = actorId;
  await patient.save();

  log.info(
    {
      patientId: String(id),
      linkedUserId: String(userId),
      linkedBy: String(actorId),
    },
    "Patient linked to user",
  );

  eventBus.emitSafe(EVENTS.PATIENT_LINKED, {
    patientId: String(id),
    clinicId: String(patient.clinicId),
    linkedUserId: String(userId),
    linkedBy: String(actorId),
  });

  return toApiShape(patient.toObject());
}

// ─── unlinkFromUser ───────────────────────────────────────────────────

export async function unlinkFromUser(id) {
  requirePerm("patient", "write");
  requireClinicId();
  const { userId: actorId } = requireActor();

  const patient = await ClinicPatient.findById(id);
  if (!patient) throw new NotFoundError("Patient");

  if (!patient.linkedUserId) {
    return toApiShape(patient.toObject()); // no-op
  }

  const previousLink = String(patient.linkedUserId);
  patient.linkedUserId = null;
  patient.lastUpdatedBy = actorId;
  await patient.save();

  log.info(
    { patientId: String(id), previousLink, unlinkedBy: String(actorId) },
    "Patient unlinked from user",
  );

  return toApiShape(patient.toObject());
}

// ─── searchUsersForLink ───────────────────────────────────────────────
//
// Search DocPats User accounts to link a ClinicPatient to. Used by the
// "Link to user" UI on the patient detail page.
//
// Two independent modes (cannot be combined):
//
//   mode "email" — exact match via emailHash blind index.
//     User enters the full email. We hash it the SAME way the User
//     model does (sha256 of trim+lowercase) and do an O(1) indexed
//     lookup. Scales to millions of users.
//
//   mode "dob" — date-of-birth + name filter.
//     User enters the full date of birth + first/last name. We query
//     User.find({ dateOfBirth }) which hits the new dateOfBirth index
//     and statistically returns only a few dozen people. Then we
//     decrypt firstName/lastName ONLY on that narrow set and filter
//     in memory (case-insensitive, prefix match). This is why it does
//     not collapse at 1M users — the expensive decrypt runs on dozens,
//     not millions.
//
// Why we don't do partial-name search globally: User names are
// sha256-hashed (one-way, exact-match only) and there's no searchable
// token field. Decrypt-then-filter across the WHOLE users collection
// would not scale. The dateOfBirth pre-filter is what makes name
// matching affordable.
//
// PHI note: this is a PHI operation (searching by DOB + name). The
// route is permission-gated (patient.write) and audited.
//
// Returns: array of { _id, firstName, lastName, email, avatar, role,
//                     dateOfBirth, username } — decrypted, display-ready.
//          Excludes soft-deleted users. Capped at DOB_SCAN_CAP.

const DOB_SCAN_CAP = 200;
const USER_SEARCH_RESULT_LIMIT = 25;

export async function searchUsersForLink(query) {
  requirePerm("patient", "write");
  requireClinicId();

  const { mode } = query;

  // Lazy import — same pattern as linkToUser / enrichWithCreatedByName
  const User = (await import("../../../../common/models/Auth/users.js"))
    .default;
  const { decrypt: decryptUser } =
    await import("../../../../common/models/Auth/users.js");

  const crypto = await import("crypto");
  const sha256 = (v) =>
    crypto.createHash("sha256").update(String(v)).digest("hex");

  const safeDecrypt = (value) => {
    if (!value) return null;
    try {
      return decryptUser(value) || null;
    } catch {
      return null;
    }
  };

  // Shape a raw lean User doc into a safe, decrypted result object.
  const toUserResult = (u) => ({
    _id: String(u._id),
    firstName: safeDecrypt(u.firstNameEncrypted),
    lastName: safeDecrypt(u.lastNameEncrypted),
    email: safeDecrypt(u.emailEncrypted),
    avatar: u.avatar || null,
    role: u.role || null,
    username: u.username || null,
    dateOfBirth: u.dateOfBirth || null,
  });

  const selectFields =
    "_id firstNameEncrypted lastNameEncrypted emailEncrypted avatar role username dateOfBirth isDeleted";

  // ─── Mode: email (exact, O(1) via blind index) ───
  if (mode === "email") {
    const raw = query.email;
    if (!raw || typeof raw !== "string") {
      throw new UnprocessableError("email is required for email search");
    }
    const normalized = raw.trim().toLowerCase();
    if (!normalized) {
      throw new UnprocessableError("email is required for email search");
    }

    const emailHash = sha256(normalized);
    const docs = await User.find({ emailHash, isDeleted: { $ne: true } })
      .select(selectFields)
      .limit(USER_SEARCH_RESULT_LIMIT)
      .lean();

    return { items: docs.map(toUserResult), count: docs.length };
  }

  // ─── Mode: dob (date of birth + name filter) ───
  if (mode === "dob") {
    const { dateOfBirth, firstName, lastName } = query;
    if (!dateOfBirth) {
      throw new UnprocessableError(
        "dateOfBirth is required for date-of-birth search",
      );
    }

    // Parse the date and build a full-day range [start, end). The
    // client sends "YYYY-MM-DD"; users in DB may have a time component,
    // so we match the whole calendar day rather than an exact instant.
    const dayStart = new Date(dateOfBirth);
    if (Number.isNaN(dayStart.getTime())) {
      throw new UnprocessableError("dateOfBirth is not a valid date");
    }
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    // Indexed query — narrows 1M users down to a few dozen.
    const candidates = await User.find({
      dateOfBirth: { $gte: dayStart, $lt: dayEnd },
      isDeleted: { $ne: true },
    })
      .select(selectFields)
      .limit(DOB_SCAN_CAP)
      .lean();

    // Decrypt + in-memory filter ONLY on the narrow candidate set.
    const fNeedle = (firstName || "").trim().toLowerCase();
    const lNeedle = (lastName || "").trim().toLowerCase();

    let results = candidates.map(toUserResult);

    // Filter by name if provided. Both partial (prefix) and
    // case-insensitive — affordable because we're filtering decrypted
    // strings on a tiny set, not hashes on millions.
    if (fNeedle || lNeedle) {
      results = results.filter((u) => {
        const fn = (u.firstName || "").toLowerCase();
        const ln = (u.lastName || "").toLowerCase();
        const fOk = fNeedle ? fn.startsWith(fNeedle) : true;
        const lOk = lNeedle ? ln.startsWith(lNeedle) : true;
        return fOk && lOk;
      });
    }

    if (results.length > USER_SEARCH_RESULT_LIMIT) {
      results = results.slice(0, USER_SEARCH_RESULT_LIMIT);
    }

    return { items: results, count: results.length };
  }

  throw new UnprocessableError(
    `Unknown search mode "${mode}" — expected "email" or "dob"`,
  );
}
