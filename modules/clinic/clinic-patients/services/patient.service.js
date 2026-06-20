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
//      ClinicEmployee depending on createdByType.
//
//      Write paths fall into two groups:
//        - create / update — caller IS the actor; frontend already knows
//          who they are, no need to enrich. Skipped.
//        - link / unlink   — caller is often DIFFERENT from the original
//          creator (e.g. receptionist created the card, admin linked it).
//          Frontend needs createdByName to render the audit trail. We
//          DO enrich on these paths. (17 May 2026 fix — previously
//          showed "Unknown" / "Неизвестно" after link/unlink in the UI.)
//
//   6. CROSS-CLINIC DEDUP (22 May 2026) — createPatient now checks the
//      global User collection by email BEFORE creating anything new.
//      Three resulting cases:
//        (a) Found active User (real registered patient with their own
//            email/password): link ClinicPatient to it, NO card issued.
//            Requires patientConsentConfirmed=true on input.
//        (b) Found provisional User (unactivated card from any clinic):
//            reissue credentials (new tmp email + password + extended
//            expiry), update/create ClinicPatient with linkedUserId,
//            issue new card. Requires patientConsentConfirmed=true.
//        (c) No User found: existing path — create User + ClinicPatient
//            from scratch (or just ClinicPatient if createProvisionalUser
//            is false).
//      Without consent, (a) and (b) return 409 with the found user's
//      identity in details, prompting UI to show a consent modal.
//
//   7. DEPARTMENT (Jun 2026) — optional departmentId on create/update.
//      Validated against the clinic's ACTIVE departments via
//      assertDepartmentInClinic (cross-module guard exported by the
//      clinic-departments service). null = unassigned. Validated up
//      front in createPatient — BEFORE any provisional/User work — so a
//      bad departmentId never leaves an orphan provisional account.

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
import {
  createProvisionalUser as createProvisionalUserSvc,
  reissueProvisionalCredentials as reissueProvisionalCredentialsSvc,
  findExistingUserByContact as findExistingUserByContactSvc,
  wipeProvisionalUser,
} from "./provisional.service.js";
import { require as requirePerm } from "../../../../common/auth/can.js";
import { assertDepartmentInClinic } from "../../clinic-departments/services/department.service.js";
import auditService from "../../../audit/services/audit.service.js";
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
    departmentId: doc.departmentId ? String(doc.departmentId) : null,
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
//
// Creates a ClinicPatient record. Now handles four flow branches
// (22 May 2026 — cross-clinic dedup):
//
//   CASE A — phone/email duplicate WITHIN this clinic
//     → 409 ConflictError(code=patient_duplicate_in_clinic, existingPatientId)
//     → UI opens existing patient detail page.
//
//   CASE B — email matches an ACTIVE User account globally
//     (user.isProvisional === false)
//     → If !patientConsentConfirmed:
//         409 ConflictError(code=user_exists_active_consent_required,
//                            existingUser: {firstName, lastName, dateOfBirth})
//     → If patientConsentConfirmed:
//         - If ClinicPatient already linked to this user in this clinic:
//             409 ConflictError(code=already_linked_here, existingPatientId)
//         - Else: create ClinicPatient with linkedUserId, NO provisional,
//             NO card. Returns { patient }.
//
//   CASE C — email matches a PROVISIONAL User (unactivated card from any clinic)
//     (user.isProvisional === true)
//     → If !patientConsentConfirmed:
//         409 ConflictError(code=user_exists_provisional_consent_required,
//                            existingUser: {firstName, lastName, dateOfBirth},
//                            originalClinicId, originalIssuedAt)
//     → If patientConsentConfirmed:
//         - Call reissueProvisionalCredentials() → new tmp email + password +
//             extended expiry, audit "user.provisional.reissued"
//         - If ClinicPatient in this clinic already exists with linkedUserId
//             pointing to this user: update its contact info (Case C3a)
//         - Else: create new ClinicPatient with linkedUserId (Case C3b)
//         - Returns { patient, provisionalCredentials } — new card issued
//
//   CASE D — no existing User by this email (or no email given at all)
//     → Existing path:
//         - If createProvisionalUser=true: createProvisionalUser() then
//             create ClinicPatient with linkedUserId. Returns
//             { patient, provisionalCredentials }.
//         - Else: just create ClinicPatient. Returns the raw patient
//             (legacy shape).
//
// Return shape:
//   Legacy callers (createProvisionalUser=false or absent, no dedup hit)
//   get the same raw patient object as before — UI-side destructuring
//   keeps working.
//   New callers (provisional flow OR Case C reissue) get
//   { patient, provisionalCredentials }.
//   Case B success returns { patient } (no credentials — patient already
//   has their own).

export async function createPatient(input) {
  requirePerm("patient", "write");
  const clinicId = requireClinicId();
  const { userId, actorType } = requireActor();

  // Validate optional department against this clinic's ACTIVE departments
  // BEFORE any provisional user/account work — fail fast so a bad
  // departmentId never leaves an orphan provisional User behind.
  // Returns the department ObjectId, or null when none was provided.
  const departmentId = await assertDepartmentInClinic(
    clinicId,
    input.departmentId,
  );

  // Normalize phone/email BEFORE encrypting so hash matches future searches
  const normalizedPhone = normalizePhone(input.phone);
  const normalizedEmail = input.email ? input.email.trim().toLowerCase() : null;

  // ─── CASE A.1 — phone duplicate in this clinic ─────────────────────
  if (normalizedPhone) {
    const phoneHash = hashValue(normalizedPhone);
    const dup = await ClinicPatient.findOne({ phoneHash }).lean();
    if (dup) {
      throw new ConflictError("Patient with this phone already exists", {
        code: "patient_duplicate_in_clinic",
        existingPatientId: String(dup._id),
        matchedField: "phone",
      });
    }
  }

  // ─── CASE A.2 — email duplicate in this clinic ─────────────────────
  // Symmetric with phone — new in May 2026. Previously only phone was
  // checked, allowing receptionists to create multiple cards for the
  // same email by accident.
  if (normalizedEmail) {
    const emailHash = hashValue(normalizedEmail);
    const dup = await ClinicPatient.findOne({ emailHash }).lean();
    if (dup) {
      throw new ConflictError("Patient with this email already exists", {
        code: "patient_duplicate_in_clinic",
        existingPatientId: String(dup._id),
        matchedField: "email",
      });
    }
  }

  // ─── CASE B/C — global User dedup by email ─────────────────────────
  // Only triggered when an email is provided. Phone-based global dedup
  // isn't supported (User model has no phone blind index).
  let existingUserMatch = null;
  if (normalizedEmail) {
    existingUserMatch = await findExistingUserByContactSvc({
      email: normalizedEmail,
    });
  }

  // ─── CASE B — found ACTIVE user globally ───────────────────────────
  if (existingUserMatch?.status === "active") {
    const existingUser = existingUserMatch.user;

    if (!input.patientConsentConfirmed) {
      // Audit the consent-required denial — every PHI lookup leaves a trail.
      // The receptionist gets the existing user's identity (firstName,
      // lastName, dateOfBirth) in the 409 details to verify against the
      // physical patient. Audit records "we surfaced PHI to clinic X about
      // user Y" so misuse can be detected later.
      try {
        auditService.recordActionAsync({
          actor: { userId, role: actorType === "employee" ? "employee" : null },
          action: "clinic.patient.lookup_consent_required",
          resourceType: "user-account",
          resourceId: String(existingUser._id),
          outcome: "denied",
          metadata: {
            scenario: "active_user_found",
            clinicId: String(clinicId),
            // we do NOT log email here — it's already in actor's request
            // body and audit chain. Logging again multiplies PHI exposure.
          },
          context: null,
        });
      } catch (auditErr) {
        log.warn(
          { err: auditErr.message },
          "Failed to audit consent_required for active user lookup",
        );
      }

      throw new ConflictError("Patient is already registered in DocPats", {
        code: "user_exists_active_consent_required",
        requiresConsent: true,
        existingUser: {
          // Decrypted on read — firstName/lastName virtuals don't fire on
          // .lean(), so we decrypt explicitly from the lean doc.
          firstName: decryptValueFromUser(existingUser.firstNameEncrypted),
          lastName: decryptValueFromUser(existingUser.lastNameEncrypted),
          dateOfBirth: existingUser.dateOfBirth || null,
        },
      });
    }

    // Consent confirmed → link path.
    // Sub-case: do we already have a ClinicPatient pointing to this user
    // in this clinic? If yes — surface as conflict so receptionist can
    // open the existing card instead of duplicating.
    const alreadyLinked = await ClinicPatient.findOne({
      linkedUserId: existingUser._id,
    }).lean();
    if (alreadyLinked) {
      throw new ConflictError(
        "This patient is already registered in your clinic",
        {
          code: "already_linked_here",
          existingPatientId: String(alreadyLinked._id),
        },
      );
    }

    // Create ClinicPatient linked to the existing User. No provisional,
    // no card — the user already has their own credentials.
    let doc;
    try {
      doc = await ClinicPatient.create({
        clinicId,
        departmentId,
        firstNameEncrypted: encryptValue(input.firstName),
        lastNameEncrypted: encryptValue(input.lastName),
        phoneEncrypted: normalizedPhone ? encryptValue(normalizedPhone) : null,
        emailEncrypted: normalizedEmail ? encryptValue(normalizedEmail) : null,
        phoneHash: normalizedPhone ? hashValue(normalizedPhone) : null,
        emailHash: normalizedEmail ? hashValue(normalizedEmail) : null,
        dateOfBirth: input.dateOfBirth || null,
        gender: input.gender || null,
        notesEncrypted: input.notes ? encryptValue(input.notes) : null,
        linkedUserId: existingUser._id,
        createdBy: userId,
        createdByType: actorType,
      });
    } catch (err) {
      // No provisional was created — no compensation needed.
      throw err;
    }

    log.info(
      {
        patientId: String(doc._id),
        clinicId: String(clinicId),
        linkedUserId: String(existingUser._id),
        scenario: "active_user_linked_with_consent",
      },
      "Patient created and linked to existing active User with consent",
    );

    // Audit: this is the consent-confirmed sister of the deny above.
    try {
      auditService.recordActionAsync({
        actor: { userId, role: actorType === "employee" ? "employee" : null },
        action: "clinic.patient.linked_with_consent",
        resourceType: "clinic-patient",
        resourceId: String(doc._id),
        outcome: "success",
        metadata: {
          linkedUserId: String(existingUser._id),
          userIsActive: true,
          clinicId: String(clinicId),
        },
        context: null,
      });
    } catch (auditErr) {
      log.warn(
        { err: auditErr.message },
        "Failed to audit linked_with_consent for active user",
      );
    }

    eventBus.emitSafe(EVENTS.PATIENT_CREATED, {
      patientId: String(doc._id),
      clinicId: String(clinicId),
      createdBy: String(userId),
      createdByType: actorType,
      linkedUserId: String(existingUser._id),
    });

    return toApiShape(doc.toObject());
  }

  // ─── CASE C — found PROVISIONAL user globally ──────────────────────
  if (existingUserMatch?.status === "provisional") {
    const existingUser = existingUserMatch.user;

    if (!input.patientConsentConfirmed) {
      try {
        auditService.recordActionAsync({
          actor: { userId, role: actorType === "employee" ? "employee" : null },
          action: "clinic.patient.lookup_consent_required",
          resourceType: "user-account",
          resourceId: String(existingUser._id),
          outcome: "denied",
          metadata: {
            scenario: "provisional_user_found",
            clinicId: String(clinicId),
            originalClinicId: existingUser.provisionalCreatedBy
              ? String(existingUser.provisionalCreatedBy)
              : null,
          },
          context: null,
        });
      } catch (auditErr) {
        log.warn(
          { err: auditErr.message },
          "Failed to audit consent_required for provisional user lookup",
        );
      }

      throw new ConflictError(
        "Patient has an unactivated card from another clinic",
        {
          code: "user_exists_provisional_consent_required",
          requiresConsent: true,
          existingUser: {
            firstName: decryptValueFromUser(existingUser.firstNameEncrypted),
            lastName: decryptValueFromUser(existingUser.lastNameEncrypted),
            dateOfBirth: existingUser.dateOfBirth || null,
          },
          originalClinicId: existingUser.provisionalCreatedBy
            ? String(existingUser.provisionalCreatedBy)
            : null,
          originalIssuedAt: existingUser.provisionalCreatedAt || null,
          reissueCount: Array.isArray(existingUser.reissueHistory)
            ? existingUser.reissueHistory.length
            : 0,
        },
      );
    }

    // Consent confirmed → reissue path.
    // dateOfBirth is required for reissue same as for fresh provisional
    // (model invariant). If receptionist somehow submitted without it,
    // fail explicitly.
    if (!input.dateOfBirth) {
      throw new ConflictError(
        "dateOfBirth is required to reissue a provisional card",
        { code: "dob_required_for_reissue", field: "dateOfBirth" },
      );
    }

    const reissueResult = await reissueProvisionalCredentialsSvc({
      userId: String(existingUser._id),
      clinicId,
      reissuedBy: userId,
      reissuedByType: actorType,
      contactEmail: normalizedEmail,
    });

    // Now — do we already have a ClinicPatient in this clinic linked to
    // this user (Case C3a)? Or do we need to create one (Case C3b)?
    let patientDoc;
    const existingInClinic = await ClinicPatient.findOne({
      linkedUserId: existingUser._id,
    });

    if (existingInClinic) {
      // Case C3a — already in this clinic. Update contact info from the
      // new input (clinic may have learned a better phone/email since
      // last visit). Medical records on this patient stay attached.
      existingInClinic.firstNameEncrypted = encryptValue(input.firstName);
      existingInClinic.lastNameEncrypted = encryptValue(input.lastName);
      if (normalizedPhone) {
        existingInClinic.phoneEncrypted = encryptValue(normalizedPhone);
        existingInClinic.phoneHash = hashValue(normalizedPhone);
      }
      if (normalizedEmail) {
        existingInClinic.emailEncrypted = encryptValue(normalizedEmail);
        existingInClinic.emailHash = hashValue(normalizedEmail);
      }
      if (input.dateOfBirth) existingInClinic.dateOfBirth = input.dateOfBirth;
      if (input.gender) existingInClinic.gender = input.gender;
      // Only touch department if the caller explicitly sent the field
      // (departmentId here is the validated value — null if cleared).
      if (input.departmentId !== undefined) {
        existingInClinic.departmentId = departmentId;
      }
      if (input.notes !== undefined) {
        existingInClinic.notesEncrypted = input.notes
          ? encryptValue(input.notes)
          : null;
      }
      existingInClinic.lastUpdatedBy = userId;
      await existingInClinic.save();
      patientDoc = existingInClinic;

      log.info(
        {
          patientId: String(patientDoc._id),
          clinicId: String(clinicId),
          linkedUserId: String(existingUser._id),
          scenario: "provisional_reissue_existing_clinic_patient",
        },
        "ClinicPatient contact info updated during provisional reissue (Case C3a)",
      );
    } else {
      // Case C3b — patient is provisional from another clinic, now first
      // visit to this clinic. Create a fresh ClinicPatient linked to
      // the same User._id.
      patientDoc = await ClinicPatient.create({
        clinicId,
        departmentId,
        firstNameEncrypted: encryptValue(input.firstName),
        lastNameEncrypted: encryptValue(input.lastName),
        phoneEncrypted: normalizedPhone ? encryptValue(normalizedPhone) : null,
        emailEncrypted: normalizedEmail ? encryptValue(normalizedEmail) : null,
        phoneHash: normalizedPhone ? hashValue(normalizedPhone) : null,
        emailHash: normalizedEmail ? hashValue(normalizedEmail) : null,
        dateOfBirth: input.dateOfBirth || null,
        gender: input.gender || null,
        notesEncrypted: input.notes ? encryptValue(input.notes) : null,
        linkedUserId: existingUser._id,
        createdBy: userId,
        createdByType: actorType,
      });

      log.info(
        {
          patientId: String(patientDoc._id),
          clinicId: String(clinicId),
          linkedUserId: String(existingUser._id),
          scenario: "provisional_reissue_new_clinic_patient",
        },
        "ClinicPatient created during cross-clinic provisional reissue (Case C3b)",
      );
    }

    // Audit at the patient level (the user-side audit is already emitted
    // by provisional.service.reissueProvisionalCredentials).
    try {
      auditService.recordActionAsync({
        actor: { userId, role: actorType === "employee" ? "employee" : null },
        action: "clinic.patient.reissued_existing_user",
        resourceType: "clinic-patient",
        resourceId: String(patientDoc._id),
        outcome: "success",
        metadata: {
          linkedUserId: String(existingUser._id),
          clinicId: String(clinicId),
          scenario: existingInClinic
            ? "existing_clinic_patient_updated"
            : "new_clinic_patient_created",
          originalClinicId: existingUser.provisionalCreatedBy
            ? String(existingUser.provisionalCreatedBy)
            : null,
        },
        context: null,
      });
    } catch (auditErr) {
      log.warn(
        { err: auditErr.message },
        "Failed to audit reissued_existing_user",
      );
    }

    eventBus.emitSafe(EVENTS.PATIENT_CREATED, {
      patientId: String(patientDoc._id),
      clinicId: String(clinicId),
      createdBy: String(userId),
      createdByType: actorType,
      linkedUserId: String(existingUser._id),
    });

    return {
      patient: toApiShape(patientDoc.toObject()),
      provisionalCredentials: {
        tmpEmail: reissueResult.tmpEmail,
        tempPassword: reissueResult.tempPassword,
        userId: String(reissueResult.user._id),
        expiresAt: reissueResult.user.provisionalExpiresAt,
      },
    };
  }

  // ─── CASE D — no existing User globally ────────────────────────────
  // Existing code path: if flagged, create a fresh provisional User, then
  // create the ClinicPatient. Order matters — User._id is needed for
  // linkedUserId before ClinicPatient save.
  let provisionalResult = null;
  if (input.createProvisionalUser === true) {
    if (!input.dateOfBirth) {
      throw new ConflictError(
        "dateOfBirth is required to create a provisional account",
        { field: "dateOfBirth" },
      );
    }
    provisionalResult = await createProvisionalUserSvc({
      clinicId,
      firstName: input.firstName,
      lastName: input.lastName,
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
      phone: normalizedPhone,
      contactEmail: normalizedEmail,
    });
    log.info(
      {
        provisionalUserId: String(provisionalResult.user._id),
        clinicId: String(clinicId),
        cardEmailRequested: Boolean(normalizedEmail),
      },
      "Provisional user created — proceeding to ClinicPatient (Case D)",
    );
  }

  // Create the ClinicPatient. If we created a provisional, link to it
  // immediately. If the create fails, wipe the orphan provisional user.
  let doc;
  try {
    doc = await ClinicPatient.create({
      clinicId,
      departmentId,
      firstNameEncrypted: encryptValue(input.firstName),
      lastNameEncrypted: encryptValue(input.lastName),
      phoneEncrypted: normalizedPhone ? encryptValue(normalizedPhone) : null,
      emailEncrypted: normalizedEmail ? encryptValue(normalizedEmail) : null,
      phoneHash: normalizedPhone ? hashValue(normalizedPhone) : null,
      emailHash: normalizedEmail ? hashValue(normalizedEmail) : null,
      dateOfBirth: input.dateOfBirth || null,
      gender: input.gender || null,
      notesEncrypted: input.notes ? encryptValue(input.notes) : null,
      linkedUserId: provisionalResult ? provisionalResult.user._id : null,
      createdBy: userId,
      createdByType: actorType,
    });
  } catch (err) {
    if (provisionalResult?.user?._id) {
      log.error(
        {
          provisionalUserId: String(provisionalResult.user._id),
          err: err.message,
        },
        "ClinicPatient creation failed — wiping orphan provisional User",
      );
      try {
        await wipeProvisionalUser(
          String(provisionalResult.user._id),
          "wiped_by_clinic",
        );
      } catch (wipeErr) {
        log.error(
          {
            provisionalUserId: String(provisionalResult.user._id),
            wipeErr: wipeErr.message,
          },
          "Failed to wipe orphan provisional User — manual cleanup needed",
        );
      }
    }
    throw err;
  }

  log.info(
    {
      patientId: String(doc._id),
      clinicId: String(clinicId),
      hasProvisional: Boolean(provisionalResult),
    },
    "Patient created (Case D)",
  );

  eventBus.emitSafe(EVENTS.PATIENT_CREATED, {
    patientId: String(doc._id),
    clinicId: String(clinicId),
    createdBy: String(userId),
    createdByType: actorType,
    linkedUserId: provisionalResult ? String(provisionalResult.user._id) : null,
  });

  const patientShape = toApiShape(doc.toObject());

  if (provisionalResult) {
    return {
      patient: patientShape,
      provisionalCredentials: {
        tmpEmail: provisionalResult.tmpEmail,
        tempPassword: provisionalResult.tempPassword,
        userId: String(provisionalResult.user._id),
        expiresAt: provisionalResult.user.provisionalExpiresAt,
      },
    };
  }

  // Legacy callers — return the raw patient object (unchanged shape).
  return patientShape;
}

// ─── helper for decrypting User PII ───────────────────────────────────
//
// User and ClinicPatient happen to use the same AES-256-CBC algorithm
// with the same ENCRYPTION_KEY (padded to 32 bytes). The ciphertext
// format is identical: "ivHex:dataHex". So we can decrypt User-side
// PII (firstNameEncrypted etc.) by feeding it into ClinicPatient's
// decryptValue() — no need to import a separate decrypt helper from
// users.js.
//
// If User's encryption ever diverges from ClinicPatient's (different
// key, different algo, different format), this helper must be updated
// to use the User-side decrypt directly.

function decryptValueFromUser(payload) {
  if (!payload) return null;
  try {
    return decryptValue(payload);
  } catch {
    return null;
  }
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
    departmentId,
  } = query;

  const filter = {};
  if (before) {
    filter[sortBy] = { $lt: before };
  }
  if (departmentId) {
    filter.departmentId = departmentId;
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
  const clinicId = requireClinicId();
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
  if (Object.prototype.hasOwnProperty.call(input, "departmentId")) {
    // null clears assignment; a real id is validated against this clinic's
    // active departments (throws ValidationError on mismatch/archived).
    update.departmentId = await assertDepartmentInClinic(
      clinicId,
      input.departmentId,
    );
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
    const candidates = await ClinicPatient.find()
      .select(
        "_id clinicId firstNameEncrypted lastNameEncrypted phoneEncrypted emailEncrypted dateOfBirth gender departmentId linkedUserId createdAt updatedAt createdBy createdByType lastVisitAt",
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

  // De-duplicate by _id
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

export async function linkToUser(id, userId) {
  requirePerm("patient", "write");
  requireClinicId();
  const { userId: actorId } = requireActor();

  const patient = await ClinicPatient.findById(id);
  if (!patient) throw new NotFoundError("Patient");

  if (patient.linkedUserId) {
    if (String(patient.linkedUserId) === String(userId)) {
      const [enriched] = await enrichWithCreatedByName([patient.toObject()]);
      return toApiShape(enriched);
    }
    throw new ConflictError(
      "Patient is already linked to a different user. Unlink first.",
      { currentLinkedUserId: String(patient.linkedUserId) },
    );
  }

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

  const [enriched] = await enrichWithCreatedByName([patient.toObject()]);
  return toApiShape(enriched);
}

// ─── unlinkFromUser ───────────────────────────────────────────────────

export async function unlinkFromUser(id) {
  requirePerm("patient", "write");
  requireClinicId();
  const { userId: actorId } = requireActor();

  const patient = await ClinicPatient.findById(id);
  if (!patient) throw new NotFoundError("Patient");

  if (!patient.linkedUserId) {
    const [enriched] = await enrichWithCreatedByName([patient.toObject()]);
    return toApiShape(enriched);
  }

  const previousLink = String(patient.linkedUserId);
  patient.linkedUserId = null;
  patient.lastUpdatedBy = actorId;
  await patient.save();

  log.info(
    { patientId: String(id), previousLink, unlinkedBy: String(actorId) },
    "Patient unlinked from user",
  );

  const [enriched] = await enrichWithCreatedByName([patient.toObject()]);
  return toApiShape(enriched);
}

// ─── searchUsersForLink ───────────────────────────────────────────────

const DOB_SCAN_CAP = 200;
const USER_SEARCH_RESULT_LIMIT = 25;

export async function searchUsersForLink(query) {
  requirePerm("patient", "write");
  requireClinicId();

  const { mode } = query;

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
    const docs = await User.find({
      emailHash,
      isDeleted: { $ne: true },
      isAnonymized: { $ne: true },
      role: { $ne: "doctor" },
      isDoctor: { $ne: true },
    })
      .select(selectFields)
      .limit(USER_SEARCH_RESULT_LIMIT)
      .lean();
    return { items: docs.map(toUserResult), count: docs.length };
  }

  if (mode === "dob") {
    const { dateOfBirth, firstName, lastName } = query;
    if (!dateOfBirth) {
      throw new UnprocessableError(
        "dateOfBirth is required for date-of-birth search",
      );
    }

    const dayStart = new Date(dateOfBirth);
    if (Number.isNaN(dayStart.getTime())) {
      throw new UnprocessableError("dateOfBirth is not a valid date");
    }
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const candidates = await User.find({
      dateOfBirth: { $gte: dayStart, $lt: dayEnd },
      isDeleted: { $ne: true },
      isAnonymized: { $ne: true },
      role: { $ne: "doctor" },
      isDoctor: { $ne: true },
    })
      .select(selectFields)
      .limit(DOB_SCAN_CAP)
      .lean();

    const fNeedle = (firstName || "").trim().toLowerCase();
    const lNeedle = (lastName || "").trim().toLowerCase();

    let results = candidates.map(toUserResult);

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
