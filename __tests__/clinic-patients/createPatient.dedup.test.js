// server/__tests__/clinic-patients/createPatient.dedup.test.js
//
// Tests for the 4-case branching added to patient.service.createPatient
// in May 2026 (cross-clinic dedup).
//
//   Case A — phone or email duplicate WITHIN this clinic
//            → 409 patient_duplicate_in_clinic
//   Case B — email matches an active DocPats User (isProvisional=false)
//            → without consent: 409 user_exists_active_consent_required
//            → with consent: ClinicPatient linked, no card
//   Case C — email matches a provisional User (isProvisional=true)
//            → without consent: 409 user_exists_provisional_consent_required
//            → with consent: reissue + ClinicPatient (update or create)
//   Case D — no User match
//            → existing path (createProvisionalUser if flag, else just CP)
//
// These tests are the bulk of Commit 4 — they pin down the behaviour
// of the most important new code path.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import argon2 from "argon2";

import { createPatient } from "../../modules/clinic/clinic-patients/services/patient.service.js";
import ClinicPatient, {
  encryptValue,
} from "../../modules/clinic/clinic-patients/models/clinicPatient.model.js";
import ClinicMembership from "../../modules/clinic/clinic-staff/models/clinicMembership.model.js";
import Clinic from "../../modules/clinic/clinic-core/models/clinic.model.js";
import User from "../../common/models/Auth/users.js";
import { runWithTenantContext } from "../../common/context/tenantContext.js";
import { ConflictError } from "../../common/utils/errors.js";

// ─── Fixture state ────────────────────────────────────────────────────

let clinicId;
let otherClinicId;
let ownerId;

/**
 * Run a thunk inside the tenant context. Default role is "owner" which
 * has the patient.write permission needed by createPatient.
 */
function actAs(role, fn, { clinic = clinicId, userId = ownerId } = {}) {
  return runWithTenantContext(
    {
      clinicId: String(clinic),
      userId: String(userId),
      actorType: "user",
      role,
    },
    fn,
  );
}

/**
 * Make a User document. Same shape as in
 * findExistingUserByContact.test.js — kept inline so the test file is
 * self-contained.
 */
async function makeUser({
  email,
  firstName = "Existing",
  lastName = "User",
  isProvisional = false,
  isAnonymized = false,
  provisionalCreatedBy = null,
  provisionalCreatedAt = null,
  provisionalExpiresAt = null,
}) {
  const passwordHash = await argon2.hash("test-pwd", {
    type: argon2.argon2id,
  });
  return User.create({
    emailEncrypted: email,
    firstNameEncrypted: firstName,
    lastNameEncrypted: lastName,
    emailHash: "placeholder",
    firstNameHash: "placeholder",
    lastNameHash: "placeholder",
    username: `u-${new mongoose.Types.ObjectId().toString()}`,
    password: passwordHash,
    dateOfBirth: new Date("1985-06-15"),
    bio: "test",
    role: "patient",
    isDoctor: false,
    isPatient: true,
    agreement: true,
    isProvisional,
    isAnonymized,
    provisionalCreatedBy,
    provisionalCreatedAt,
    provisionalExpiresAt,
  });
}

// ─── Setup ────────────────────────────────────────────────────────────

beforeEach(async () => {
  await Clinic.collection.deleteMany({});
  await ClinicMembership.collection.deleteMany({});
  await ClinicPatient.collection.deleteMany({});
  await User.collection.deleteMany({});

  clinicId = new mongoose.Types.ObjectId();
  otherClinicId = new mongoose.Types.ObjectId();
  ownerId = new mongoose.Types.ObjectId();

  await Clinic.create({
    _id: clinicId,
    name: "Main Clinic",
    slug: `main-clinic-${clinicId.toString().slice(-8)}`,
    ownerId,
    timezone: "Asia/Baku",
  });
  await Clinic.create({
    _id: otherClinicId,
    name: "Other Clinic",
    slug: `other-clinic-${otherClinicId.toString().slice(-8)}`,
    ownerId,
    timezone: "Asia/Baku",
  });

  // Owner membership in main clinic — required for permission check
  await ClinicMembership.create({
    userId: ownerId,
    clinicId,
    role: "owner",
    actorType: "user",
    isActive: true,
    isPrimary: true,
    joinedAt: new Date(),
  });
});

// ════════════════════════════════════════════════════════════════
//  Case A — duplicate within the same clinic
// ════════════════════════════════════════════════════════════════

describe("createPatient Case A — duplicate within clinic", () => {
  it("refuses second patient with the same phone", async () => {
    await actAs("owner", () =>
      createPatient({
        firstName: "First",
        lastName: "One",
        phone: "+994501234567",
        dateOfBirth: new Date("1990-01-01"),
      }),
    );

    await expect(
      actAs("owner", () =>
        createPatient({
          firstName: "Second",
          lastName: "Two",
          phone: "+994501234567",
          dateOfBirth: new Date("1991-01-01"),
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("conflict details point to patient_duplicate_in_clinic + matchedField=phone", async () => {
    const first = await actAs("owner", () =>
      createPatient({
        firstName: "First",
        lastName: "One",
        phone: "+994501234567",
        dateOfBirth: new Date("1990-01-01"),
      }),
    );

    try {
      await actAs("owner", () =>
        createPatient({
          firstName: "Second",
          lastName: "Two",
          phone: "+994501234567",
        }),
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError);
      expect(err.details?.code).toBe("patient_duplicate_in_clinic");
      expect(err.details?.matchedField).toBe("phone");
      expect(err.details?.existingPatientId).toBe(String(first._id));
    }
  });

  it("refuses second patient with the same email", async () => {
    await actAs("owner", () =>
      createPatient({
        firstName: "First",
        lastName: "One",
        email: "dup@example.com",
        dateOfBirth: new Date("1990-01-01"),
      }),
    );

    await expect(
      actAs("owner", () =>
        createPatient({
          firstName: "Second",
          lastName: "Two",
          email: "dup@example.com",
          dateOfBirth: new Date("1991-01-01"),
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("conflict details point to matchedField=email for email dup", async () => {
    await actAs("owner", () =>
      createPatient({
        firstName: "First",
        lastName: "One",
        email: "dup@example.com",
        dateOfBirth: new Date("1990-01-01"),
      }),
    );

    try {
      await actAs("owner", () =>
        createPatient({
          firstName: "Second",
          lastName: "Two",
          email: "dup@example.com",
        }),
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect(err.details?.code).toBe("patient_duplicate_in_clinic");
      expect(err.details?.matchedField).toBe("email");
    }
  });

  it("allows the same phone in a DIFFERENT clinic (tenant isolation)", async () => {
    await actAs("owner", () =>
      createPatient({
        firstName: "First",
        lastName: "One",
        phone: "+994501234567",
        dateOfBirth: new Date("1990-01-01"),
      }),
    );

    // Other clinic should not be blocked
    const otherOwnerId = new mongoose.Types.ObjectId();
    await ClinicMembership.create({
      userId: otherOwnerId,
      clinicId: otherClinicId,
      role: "owner",
      actorType: "user",
      isActive: true,
    });

    const result = await runWithTenantContext(
      {
        clinicId: String(otherClinicId),
        userId: String(otherOwnerId),
        actorType: "user",
        role: "owner",
      },
      () =>
        createPatient({
          firstName: "Second",
          lastName: "Two",
          phone: "+994501234567",
          dateOfBirth: new Date("1991-01-01"),
        }),
    );

    expect(result._id).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════
//  Case B — active User found globally
// ════════════════════════════════════════════════════════════════

describe("createPatient Case B — active User without consent", () => {
  beforeEach(async () => {
    await makeUser({
      email: "active@example.com",
      firstName: "Alice",
      lastName: "Active",
      isProvisional: false,
    });
  });

  it("throws 409 with user_exists_active_consent_required code", async () => {
    try {
      await actAs("owner", () =>
        createPatient({
          firstName: "Receptionist-input",
          lastName: "Input",
          email: "active@example.com",
        }),
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError);
      expect(err.details?.code).toBe("user_exists_active_consent_required");
      expect(err.details?.requiresConsent).toBe(true);
    }
  });

  it("conflict payload contains decrypted firstName + lastName + dob", async () => {
    try {
      await actAs("owner", () =>
        createPatient({
          firstName: "Whatever",
          lastName: "Input",
          email: "active@example.com",
        }),
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect(err.details.existingUser.firstName).toBe("Alice");
      expect(err.details.existingUser.lastName).toBe("Active");
      expect(err.details.existingUser.dateOfBirth).toBeDefined();
    }
  });

  it("does NOT create a ClinicPatient when 409 was returned", async () => {
    try {
      await actAs("owner", () =>
        createPatient({
          firstName: "Whatever",
          lastName: "Input",
          email: "active@example.com",
        }),
      );
    } catch {
      // expected
    }

    const count = await ClinicPatient.countDocuments({});
    expect(count).toBe(0);
  });
});

describe("createPatient Case B — active User with consent", () => {
  let activeUser;

  beforeEach(async () => {
    activeUser = await makeUser({
      email: "active@example.com",
      firstName: "Alice",
      lastName: "Active",
      isProvisional: false,
    });
  });

  it("creates ClinicPatient linked to existing User", async () => {
    const result = await actAs("owner", () =>
      createPatient({
        firstName: "Alice",
        lastName: "Active",
        email: "active@example.com",
        patientConsentConfirmed: true,
      }),
    );

    // Active-case returns the patient directly (no provisional credentials)
    const patient = result?.patient ?? result;
    expect(patient._id).toBeDefined();
    expect(String(patient.linkedUserId)).toBe(String(activeUser._id));
  });

  it("returned shape has NO provisionalCredentials (user already has theirs)", async () => {
    const result = await actAs("owner", () =>
      createPatient({
        firstName: "Alice",
        lastName: "Active",
        email: "active@example.com",
        patientConsentConfirmed: true,
      }),
    );

    expect(result?.provisionalCredentials).toBeUndefined();
  });

  it("does NOT create a new User for the link", async () => {
    const userCountBefore = await User.countDocuments({});

    await actAs("owner", () =>
      createPatient({
        firstName: "Alice",
        lastName: "Active",
        email: "active@example.com",
        patientConsentConfirmed: true,
      }),
    );

    const userCountAfter = await User.countDocuments({});
    expect(userCountAfter).toBe(userCountBefore);
  });

  it("refuses with already_linked_here if a ClinicPatient is already linked", async () => {
    // Simulate the "already linked" scenario directly: create a
    // ClinicPatient by hand that's linked to the active User but uses
    // a DIFFERENT email (or no email at all) in ClinicPatient — that
    // way the same-clinic email-dup check (Case A.2) doesn't fire
    // first and we hit the actual already_linked_here branch.
    //
    // Why this matters: in the real flow, the first call lands in
    // Case B-with-consent and creates a ClinicPatient with the user's
    // current email. A second call with that same email gets caught
    // by Case A.2 (email dup in clinic) — that's correct, the user
    // sees a "duplicate in your clinic" dialog. The already_linked_here
    // code only triggers in a pathological case: the ClinicPatient was
    // linked previously but its emailEncrypted differs from the current
    // input. We construct that scenario explicitly.
    await actAs("owner", () =>
      new ClinicPatient({
        clinicId,
        firstNameEncrypted: encryptValue("Alice"),
        lastNameEncrypted: encryptValue("Active"),
        // No email on the existing ClinicPatient → Case A.2 won't fire
        emailEncrypted: null,
        emailHash: null,
        linkedUserId: activeUser._id,
        createdBy: ownerId,
        createdByType: "user",
      }).save(),
    );

    try {
      await actAs("owner", () =>
        createPatient({
          firstName: "Alice",
          lastName: "Active",
          email: "active@example.com",
          patientConsentConfirmed: true,
        }),
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError);
      expect(err.details?.code).toBe("already_linked_here");
      expect(err.details?.existingPatientId).toBeDefined();
    }
  });
});

// ════════════════════════════════════════════════════════════════
//  Case C — provisional User found globally
// ════════════════════════════════════════════════════════════════

describe("createPatient Case C — provisional User without consent", () => {
  let provisionalUser;
  let provisionalCreatorClinicId;

  beforeEach(async () => {
    // A "previous" clinic that created this provisional 60 days ago
    provisionalCreatorClinicId = new mongoose.Types.ObjectId();
    await Clinic.create({
      _id: provisionalCreatorClinicId,
      name: "Previous Clinic",
      slug: `prev-${provisionalCreatorClinicId.toString().slice(-8)}`,
      ownerId,
      timezone: "Asia/Baku",
    });

    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    provisionalUser = await makeUser({
      email: "provisional@example.com",
      firstName: "Pavel",
      lastName: "Provisional",
      isProvisional: true,
      provisionalCreatedBy: provisionalCreatorClinicId,
      provisionalCreatedAt: sixtyDaysAgo,
      provisionalExpiresAt: new Date(
        sixtyDaysAgo.getTime() + 3 * 365 * 24 * 60 * 60 * 1000,
      ),
    });
  });

  it("throws 409 with user_exists_provisional_consent_required code", async () => {
    try {
      await actAs("owner", () =>
        createPatient({
          firstName: "Receptionist-input",
          lastName: "Input",
          email: "provisional@example.com",
        }),
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError);
      expect(err.details?.code).toBe(
        "user_exists_provisional_consent_required",
      );
      expect(err.details?.requiresConsent).toBe(true);
    }
  });

  it("conflict payload contains original issuance date + reissueCount=0", async () => {
    try {
      await actAs("owner", () =>
        createPatient({
          firstName: "Whatever",
          lastName: "Input",
          email: "provisional@example.com",
        }),
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect(err.details.originalIssuedAt).toBeDefined();
      expect(err.details.reissueCount).toBe(0);
      expect(err.details.existingUser.firstName).toBe("Pavel");
      expect(err.details.existingUser.lastName).toBe("Provisional");
    }
  });

  it("does NOT touch the User document when no consent", async () => {
    const before = await User.findById(provisionalUser._id).lean();

    try {
      await actAs("owner", () =>
        createPatient({
          firstName: "Whatever",
          lastName: "Input",
          email: "provisional@example.com",
        }),
      );
    } catch {
      // expected
    }

    const after = await User.findById(provisionalUser._id).lean();
    expect(after.emailEncrypted).toBe(before.emailEncrypted);
    expect(after.password).toBe(before.password);
    expect(after.provisionalExpiresAt.getTime()).toBe(
      before.provisionalExpiresAt.getTime(),
    );
  });
});

describe("createPatient Case C — provisional User with consent (C3b: cross-clinic)", () => {
  let provisionalUser;
  let prevClinicId;

  beforeEach(async () => {
    prevClinicId = new mongoose.Types.ObjectId();
    await Clinic.create({
      _id: prevClinicId,
      name: "Previous Clinic",
      slug: `prev-${prevClinicId.toString().slice(-8)}`,
      ownerId,
      timezone: "Asia/Baku",
    });

    provisionalUser = await makeUser({
      email: "cross@example.com",
      firstName: "Cross",
      lastName: "Clinic",
      isProvisional: true,
      provisionalCreatedBy: prevClinicId,
      provisionalCreatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      provisionalExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    });
  });

  it("reissues credentials and creates ClinicPatient with linkedUserId", async () => {
    const result = await actAs("owner", () =>
      createPatient({
        firstName: "Cross",
        lastName: "Clinic",
        email: "cross@example.com",
        dateOfBirth: new Date("1985-06-15"),
        patientConsentConfirmed: true,
      }),
    );

    // Case C returns { patient, provisionalCredentials } — both must exist
    expect(result.patient).toBeDefined();
    expect(result.patient._id).toBeDefined();
    expect(String(result.patient.linkedUserId)).toBe(
      String(provisionalUser._id),
    );

    expect(result.provisionalCredentials).toBeDefined();
    expect(result.provisionalCredentials.tmpEmail).toMatch(
      /^patient\..+@docpats\.com$/,
    );
    expect(result.provisionalCredentials.tempPassword).toBeDefined();
  });

  it("new tmpEmail uses the REISSUING clinic's slug", async () => {
    const reissuingClinic = await Clinic.findById(clinicId).lean();
    const result = await actAs("owner", () =>
      createPatient({
        firstName: "Cross",
        lastName: "Clinic",
        email: "cross@example.com",
        dateOfBirth: new Date("1985-06-15"),
        patientConsentConfirmed: true,
      }),
    );

    expect(result.provisionalCredentials.tmpEmail).toContain(
      reissuingClinic.slug,
    );
  });

  it("provisionalCreatedBy stays unchanged on the User", async () => {
    await actAs("owner", () =>
      createPatient({
        firstName: "Cross",
        lastName: "Clinic",
        email: "cross@example.com",
        dateOfBirth: new Date("1985-06-15"),
        patientConsentConfirmed: true,
      }),
    );

    const updated = await User.findById(provisionalUser._id);
    expect(String(updated.provisionalCreatedBy)).toBe(String(prevClinicId));
  });

  it("appends to User.reissueHistory", async () => {
    await actAs("owner", () =>
      createPatient({
        firstName: "Cross",
        lastName: "Clinic",
        email: "cross@example.com",
        dateOfBirth: new Date("1985-06-15"),
        patientConsentConfirmed: true,
      }),
    );

    const updated = await User.findById(provisionalUser._id);
    expect(updated.reissueHistory).toHaveLength(1);
    expect(String(updated.reissueHistory[0].clinicId)).toBe(String(clinicId));
  });
});

describe("createPatient Case C — provisional User with consent (C3a: same clinic)", () => {
  let provisionalUser;
  let existingPatient;

  beforeEach(async () => {
    // Provisional was created by THIS clinic originally
    provisionalUser = await makeUser({
      email: "samelocal@example.com",
      firstName: "Same",
      lastName: "Clinic",
      isProvisional: true,
      provisionalCreatedBy: clinicId,
      provisionalCreatedAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
      provisionalExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    });

    // Existing ClinicPatient linked to that provisional User.
    //
    // NOTE: we deliberately do NOT set emailEncrypted/emailHash on the
    // existing patient here. If we did, the Case A.2 check
    // (same-clinic email duplicate) would fire BEFORE the User-side
    // dedup that triggers Case C — and we want to test the C3a path,
    // not A.2. In real-world C3a, the existing ClinicPatient was
    // typically created via the provisional flow without an email
    // (clinic only ever knew the tmp email which lives on User, not
    // ClinicPatient), so this is also the realistic state.
    existingPatient = await actAs("owner", () =>
      new ClinicPatient({
        clinicId,
        firstNameEncrypted: encryptValue("Same"),
        lastNameEncrypted: encryptValue("Clinic"),
        emailEncrypted: null,
        emailHash: null,
        linkedUserId: provisionalUser._id,
        createdBy: ownerId,
        createdByType: "user",
      }).save(),
    );
  });

  it("updates existing ClinicPatient rather than creating a duplicate", async () => {
    const result = await actAs("owner", () =>
      createPatient({
        firstName: "Same",
        lastName: "Clinic",
        email: "samelocal@example.com",
        dateOfBirth: new Date("1985-06-15"),
        patientConsentConfirmed: true,
      }),
    );

    expect(String(result.patient._id)).toBe(String(existingPatient._id));

    // No duplicate
    const count = await ClinicPatient.countDocuments({ clinicId });
    expect(count).toBe(1);
  });

  it("still returns new provisionalCredentials (card reissued)", async () => {
    const result = await actAs("owner", () =>
      createPatient({
        firstName: "Same",
        lastName: "Clinic",
        email: "samelocal@example.com",
        dateOfBirth: new Date("1985-06-15"),
        patientConsentConfirmed: true,
      }),
    );

    expect(result.provisionalCredentials).toBeDefined();
    expect(result.provisionalCredentials.tempPassword).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════
//  Case D — no match
// ════════════════════════════════════════════════════════════════

describe("createPatient Case D — no existing user", () => {
  it("creates fresh ClinicPatient when no User exists and flag is false", async () => {
    const result = await actAs("owner", () =>
      createPatient({
        firstName: "Brand",
        lastName: "New",
        email: "brand-new@example.com",
        dateOfBirth: new Date("1995-03-22"),
      }),
    );

    const patient = result?.patient ?? result;
    expect(patient._id).toBeDefined();
    expect(patient.linkedUserId).toBeNull();
  });

  it("creates fresh ClinicPatient + provisional User when flag is true", async () => {
    const result = await actAs("owner", () =>
      createPatient({
        firstName: "Brand",
        lastName: "New",
        email: "brand-new@example.com",
        dateOfBirth: new Date("1995-03-22"),
        createProvisionalUser: true,
      }),
    );

    expect(result.patient).toBeDefined();
    expect(result.provisionalCredentials).toBeDefined();
    expect(String(result.patient.linkedUserId)).toBeTruthy();
  });

  it("works without email field (no global dedup search runs)", async () => {
    const result = await actAs("owner", () =>
      createPatient({
        firstName: "Brand",
        lastName: "New",
        phone: "+994559999999",
        dateOfBirth: new Date("1995-03-22"),
      }),
    );

    const patient = result?.patient ?? result;
    expect(patient._id).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════
//  edge — anonymized user doesn't trigger dedup
// ════════════════════════════════════════════════════════════════

describe("createPatient — anonymized user is invisible to dedup", () => {
  it("doesn't see anonymized User by email — proceeds to Case D", async () => {
    await makeUser({
      email: "gone@example.com",
      firstName: "Gone",
      lastName: "Anonymized",
      isProvisional: true,
      isAnonymized: true,
    });

    // Should NOT throw — anonymized user is effectively absent for dedup
    const result = await actAs("owner", () =>
      createPatient({
        firstName: "New",
        lastName: "Patient",
        email: "gone@example.com",
        dateOfBirth: new Date("1990-01-01"),
      }),
    );

    const patient = result?.patient ?? result;
    expect(patient._id).toBeDefined();
  });
});
