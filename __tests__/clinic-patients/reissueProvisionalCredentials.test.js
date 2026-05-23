// server/__tests__/clinic-patients/reissueProvisionalCredentials.test.js
//
// Tests for reissueProvisionalCredentials — the credential-refresh path
// used in Case C of patient.service.createPatient (May 2026).
//
// Critical invariants under test:
//   - emailEncrypted is rotated to a NEW tmp email under the reissuing
//     clinic's slug (not the original clinic's slug)
//   - password hash is rotated (different argon2 hash even if you
//     reissued seconds apart)
//   - provisionalExpiresAt is reset to now + 3 years
//   - provisionalCreatedBy stays UNCHANGED (original clinic remembered
//     forever; reissue history tracked separately)
//   - reissueHistory has a new entry with previousExpiresAt = old expiry
//   - mustCompleteRegistration is set/kept true
//   - pending OTP/email-change fields are cleared
//   - REFUSED on isProvisional=false (security: never overwrite an
//     activated account)
//   - REFUSED on isAnonymized=true (security: never resurrect wiped data)
//   - REFUSED if reissuedByType is invalid
//
// We do NOT test the SMTP delivery — that's fire-and-forget and well
// out of scope here. We do test that the function returns the tmpEmail
// and tempPassword for the card render.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import argon2 from "argon2";

import { reissueProvisionalCredentials } from "../../modules/clinic/clinic-patients/services/provisional.service.js";
import User from "../../common/models/Auth/users.js";
import Clinic from "../../modules/clinic/clinic-core/models/clinic.model.js";
import { ValidationError, NotFoundError } from "../../common/utils/errors.js";

// ─── Fixtures ─────────────────────────────────────────────────────────

let originalClinicId;
let reissuingClinicId;
let ownerId;
let receptionistId;
let provisionalUser;

beforeEach(async () => {
  await User.collection.deleteMany({});
  await Clinic.collection.deleteMany({});

  originalClinicId = new mongoose.Types.ObjectId();
  reissuingClinicId = new mongoose.Types.ObjectId();
  ownerId = new mongoose.Types.ObjectId();
  receptionistId = new mongoose.Types.ObjectId();

  // Both clinics — required because the service validates them.
  await Clinic.create({
    _id: originalClinicId,
    name: "Original Clinic",
    slug: `orig-clinic-${originalClinicId.toString().slice(-8)}`,
    ownerId,
    timezone: "Asia/Baku",
  });
  await Clinic.create({
    _id: reissuingClinicId,
    name: "Reissuing Clinic",
    slug: `reissue-clinic-${reissuingClinicId.toString().slice(-8)}`,
    ownerId,
    timezone: "Asia/Baku",
  });

  // A provisional user, "created" by the original clinic 90 days ago,
  // with original expiry of "today + 3 years" minus that 90 days.
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const originalExpiresAt = new Date(
    ninetyDaysAgo.getTime() + 3 * 365 * 24 * 60 * 60 * 1000,
  );

  provisionalUser = await User.create({
    emailEncrypted: "patient.orig-clinic.abc123@docpats.com",
    firstNameEncrypted: "Ivan",
    lastNameEncrypted: "Patientov",
    emailHash: "placeholder",
    firstNameHash: "placeholder",
    lastNameHash: "placeholder",
    username: `patient-${new mongoose.Types.ObjectId().toString()}`,
    password: await argon2.hash("original-temp-password", {
      type: argon2.argon2id,
    }),
    dateOfBirth: new Date("1985-06-15"),
    bio: "Provisional patient record",
    role: "patient",
    isDoctor: false,
    isPatient: true,
    agreement: true,
    isProvisional: true,
    provisionalCreatedBy: originalClinicId,
    provisionalCreatedAt: ninetyDaysAgo,
    provisionalExpiresAt: originalExpiresAt,
    mustCompleteRegistration: true,
  });
});

// ════════════════════════════════════════════════════════════════
//  input validation
// ════════════════════════════════════════════════════════════════

describe("reissueProvisionalCredentials — input validation", () => {
  it("throws ValidationError when userId is missing", async () => {
    await expect(
      reissueProvisionalCredentials({
        clinicId: String(reissuingClinicId),
        reissuedBy: String(receptionistId),
        reissuedByType: "user",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError when clinicId is missing", async () => {
    await expect(
      reissueProvisionalCredentials({
        userId: String(provisionalUser._id),
        reissuedBy: String(receptionistId),
        reissuedByType: "user",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError when reissuedBy is missing", async () => {
    await expect(
      reissueProvisionalCredentials({
        userId: String(provisionalUser._id),
        clinicId: String(reissuingClinicId),
        reissuedByType: "user",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError when reissuedByType is invalid", async () => {
    await expect(
      reissueProvisionalCredentials({
        userId: String(provisionalUser._id),
        clinicId: String(reissuingClinicId),
        reissuedBy: String(receptionistId),
        reissuedByType: "robot",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws NotFoundError when user does not exist", async () => {
    await expect(
      reissueProvisionalCredentials({
        userId: String(new mongoose.Types.ObjectId()),
        clinicId: String(reissuingClinicId),
        reissuedBy: String(receptionistId),
        reissuedByType: "user",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws NotFoundError when clinic does not exist", async () => {
    await expect(
      reissueProvisionalCredentials({
        userId: String(provisionalUser._id),
        clinicId: String(new mongoose.Types.ObjectId()),
        reissuedBy: String(receptionistId),
        reissuedByType: "user",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ════════════════════════════════════════════════════════════════
//  security guards — never overwrite real accounts
// ════════════════════════════════════════════════════════════════

describe("reissueProvisionalCredentials — security guards", () => {
  it("refuses to reissue when user is no longer provisional", async () => {
    // Simulate: patient activated their account between Step 1 of the
    // clinic flow and consent confirmation. Reissue MUST refuse, or we'd
    // overwrite their real email and password.
    provisionalUser.isProvisional = false;
    await provisionalUser.save();

    await expect(
      reissueProvisionalCredentials({
        userId: String(provisionalUser._id),
        clinicId: String(reissuingClinicId),
        reissuedBy: String(receptionistId),
        reissuedByType: "user",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses to reissue an anonymized account", async () => {
    provisionalUser.isAnonymized = true;
    provisionalUser.anonymizedAt = new Date();
    provisionalUser.anonymizedReason = "expired";
    await provisionalUser.save();

    await expect(
      reissueProvisionalCredentials({
        userId: String(provisionalUser._id),
        clinicId: String(reissuingClinicId),
        reissuedBy: String(receptionistId),
        reissuedByType: "user",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ════════════════════════════════════════════════════════════════
//  happy-path mutations
// ════════════════════════════════════════════════════════════════

describe("reissueProvisionalCredentials — happy path", () => {
  it("returns new tmpEmail and tempPassword", async () => {
    const result = await reissueProvisionalCredentials({
      userId: String(provisionalUser._id),
      clinicId: String(reissuingClinicId),
      reissuedBy: String(receptionistId),
      reissuedByType: "user",
    });

    expect(result).toBeDefined();
    expect(result.tmpEmail).toMatch(/^patient\..+@docpats\.com$/);
    expect(typeof result.tempPassword).toBe("string");
    expect(result.tempPassword.length).toBeGreaterThanOrEqual(11); // "Aaa-bbb-ccc"
  });

  it("new tmpEmail uses the REISSUING clinic's slug (not the original)", async () => {
    const reissuingClinic = await Clinic.findById(reissuingClinicId).lean();

    const result = await reissueProvisionalCredentials({
      userId: String(provisionalUser._id),
      clinicId: String(reissuingClinicId),
      reissuedBy: String(receptionistId),
      reissuedByType: "user",
    });

    expect(result.tmpEmail).toContain(reissuingClinic.slug);
  });

  it("updates User.emailEncrypted to the new tmp email", async () => {
    const oldEmail = provisionalUser.emailEncrypted;

    await reissueProvisionalCredentials({
      userId: String(provisionalUser._id),
      clinicId: String(reissuingClinicId),
      reissuedBy: String(receptionistId),
      reissuedByType: "user",
    });

    const updated = await User.findById(provisionalUser._id);
    expect(updated.emailEncrypted).not.toBe(oldEmail);
  });

  it("rotates the password hash (different argon2 hash)", async () => {
    const oldPasswordHash = provisionalUser.password;

    await reissueProvisionalCredentials({
      userId: String(provisionalUser._id),
      clinicId: String(reissuingClinicId),
      reissuedBy: String(receptionistId),
      reissuedByType: "user",
    });

    const updated = await User.findById(provisionalUser._id);
    expect(updated.password).not.toBe(oldPasswordHash);
    expect(updated.password.startsWith("$argon2id$")).toBe(true);
  });

  it("resets provisionalExpiresAt to now + 3 years (sliding window)", async () => {
    const before = Date.now();

    await reissueProvisionalCredentials({
      userId: String(provisionalUser._id),
      clinicId: String(reissuingClinicId),
      reissuedBy: String(receptionistId),
      reissuedByType: "user",
    });

    const updated = await User.findById(provisionalUser._id);
    const newExpiry = updated.provisionalExpiresAt.getTime();
    const threeYearsMs = 3 * 365 * 24 * 60 * 60 * 1000;

    // Should be ~3 years from "now" — allow a generous 5-second window
    // for test execution overhead.
    expect(newExpiry).toBeGreaterThanOrEqual(before + threeYearsMs - 5000);
    expect(newExpiry).toBeLessThanOrEqual(Date.now() + threeYearsMs + 5000);
  });

  it("does NOT change provisionalCreatedBy (original clinic remembered)", async () => {
    await reissueProvisionalCredentials({
      userId: String(provisionalUser._id),
      clinicId: String(reissuingClinicId),
      reissuedBy: String(receptionistId),
      reissuedByType: "user",
    });

    const updated = await User.findById(provisionalUser._id);
    expect(String(updated.provisionalCreatedBy)).toBe(String(originalClinicId));
  });

  it("does NOT change provisionalCreatedAt", async () => {
    const originalCreatedAt = provisionalUser.provisionalCreatedAt;

    await reissueProvisionalCredentials({
      userId: String(provisionalUser._id),
      clinicId: String(reissuingClinicId),
      reissuedBy: String(receptionistId),
      reissuedByType: "user",
    });

    const updated = await User.findById(provisionalUser._id);
    expect(updated.provisionalCreatedAt.getTime()).toBe(
      originalCreatedAt.getTime(),
    );
  });

  it("keeps isProvisional = true", async () => {
    await reissueProvisionalCredentials({
      userId: String(provisionalUser._id),
      clinicId: String(reissuingClinicId),
      reissuedBy: String(receptionistId),
      reissuedByType: "user",
    });

    const updated = await User.findById(provisionalUser._id);
    expect(updated.isProvisional).toBe(true);
  });

  it("sets mustCompleteRegistration to true", async () => {
    // Set to false to confirm the function flips it back.
    provisionalUser.mustCompleteRegistration = false;
    await provisionalUser.save();

    await reissueProvisionalCredentials({
      userId: String(provisionalUser._id),
      clinicId: String(reissuingClinicId),
      reissuedBy: String(receptionistId),
      reissuedByType: "user",
    });

    const updated = await User.findById(provisionalUser._id);
    expect(updated.mustCompleteRegistration).toBe(true);
  });

  it("does NOT change firstName/lastName/dateOfBirth", async () => {
    const originalDob = provisionalUser.dateOfBirth.getTime();

    await reissueProvisionalCredentials({
      userId: String(provisionalUser._id),
      clinicId: String(reissuingClinicId),
      reissuedBy: String(receptionistId),
      reissuedByType: "user",
    });

    const updated = await User.findById(provisionalUser._id);
    // Virtuals decrypt firstNameEncrypted/lastNameEncrypted
    expect(updated.firstName).toBe("Ivan");
    expect(updated.lastName).toBe("Patientov");
    expect(updated.dateOfBirth.getTime()).toBe(originalDob);
  });
});

// ════════════════════════════════════════════════════════════════
//  reissueHistory append
// ════════════════════════════════════════════════════════════════

describe("reissueProvisionalCredentials — reissueHistory", () => {
  it("appends one entry to reissueHistory on first reissue", async () => {
    expect(provisionalUser.reissueHistory).toHaveLength(0);
    const previousExpiry = provisionalUser.provisionalExpiresAt;

    await reissueProvisionalCredentials({
      userId: String(provisionalUser._id),
      clinicId: String(reissuingClinicId),
      reissuedBy: String(receptionistId),
      reissuedByType: "user",
    });

    const updated = await User.findById(provisionalUser._id);
    expect(updated.reissueHistory).toHaveLength(1);

    const entry = updated.reissueHistory[0];
    expect(String(entry.clinicId)).toBe(String(reissuingClinicId));
    expect(String(entry.reissuedBy)).toBe(String(receptionistId));
    expect(entry.reissuedByType).toBe("user");
    expect(entry.reissuedAt).toBeInstanceOf(Date);
    expect(entry.previousExpiresAt.getTime()).toBe(previousExpiry.getTime());
  });

  it("appends another entry on each subsequent reissue", async () => {
    // First reissue
    await reissueProvisionalCredentials({
      userId: String(provisionalUser._id),
      clinicId: String(reissuingClinicId),
      reissuedBy: String(receptionistId),
      reissuedByType: "user",
    });

    // Different clinic does a second reissue
    const thirdClinicId = new mongoose.Types.ObjectId();
    await Clinic.create({
      _id: thirdClinicId,
      name: "Third Clinic",
      slug: `third-clinic-${thirdClinicId.toString().slice(-8)}`,
      ownerId,
      timezone: "Asia/Baku",
    });
    const thirdReceptionistId = new mongoose.Types.ObjectId();

    await reissueProvisionalCredentials({
      userId: String(provisionalUser._id),
      clinicId: String(thirdClinicId),
      reissuedBy: String(thirdReceptionistId),
      reissuedByType: "user",
    });

    const updated = await User.findById(provisionalUser._id);
    expect(updated.reissueHistory).toHaveLength(2);
    expect(String(updated.reissueHistory[0].clinicId)).toBe(
      String(reissuingClinicId),
    );
    expect(String(updated.reissueHistory[1].clinicId)).toBe(
      String(thirdClinicId),
    );
  });

  it("reissueCount virtual reflects history length", async () => {
    await reissueProvisionalCredentials({
      userId: String(provisionalUser._id),
      clinicId: String(reissuingClinicId),
      reissuedBy: String(receptionistId),
      reissuedByType: "user",
    });
    await reissueProvisionalCredentials({
      userId: String(provisionalUser._id),
      clinicId: String(reissuingClinicId),
      reissuedBy: String(receptionistId),
      reissuedByType: "user",
    });

    const updated = await User.findById(provisionalUser._id);
    expect(updated.reissueCount).toBe(2);
  });

  it("supports reissuedByType = 'employee'", async () => {
    await reissueProvisionalCredentials({
      userId: String(provisionalUser._id),
      clinicId: String(reissuingClinicId),
      reissuedBy: String(receptionistId),
      reissuedByType: "employee",
    });

    const updated = await User.findById(provisionalUser._id);
    expect(updated.reissueHistory[0].reissuedByType).toBe("employee");
  });
});

// ════════════════════════════════════════════════════════════════
//  pending OTP state cleanup
// ════════════════════════════════════════════════════════════════

describe("reissueProvisionalCredentials — pending OTP cleanup", () => {
  it("clears any pending activation OTP fields", async () => {
    // Simulate: patient started activation, got OTP, but never finished —
    // then walks into new clinic which reissues. OTP state from the OLD
    // creds must not survive into the new creds.
    provisionalUser.activationOtp = "123456";
    provisionalUser.activationOtpExpiresAt = new Date(Date.now() + 600000);
    provisionalUser.activationOtpAttempts = 2;
    provisionalUser.activationOtpLastSentAt = new Date();
    provisionalUser.pendingNewEmailEncrypted = "iv:somerandomencryptedblob";
    provisionalUser.pendingNewPasswordHash = "$argon2id$old-hash";
    await provisionalUser.save();

    await reissueProvisionalCredentials({
      userId: String(provisionalUser._id),
      clinicId: String(reissuingClinicId),
      reissuedBy: String(receptionistId),
      reissuedByType: "user",
    });

    const updated = await User.findById(provisionalUser._id);
    expect(updated.activationOtp).toBeNull();
    expect(updated.activationOtpExpiresAt).toBeNull();
    expect(updated.activationOtpAttempts).toBe(0);
    expect(updated.activationOtpLastSentAt).toBeNull();
    expect(updated.pendingNewEmailEncrypted).toBeNull();
    expect(updated.pendingNewPasswordHash).toBeNull();
  });
});
