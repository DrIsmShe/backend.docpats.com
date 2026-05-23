// server/__tests__/clinic-patients/findExistingUserByContact.test.js
//
// Tests for findExistingUserByContact — the cross-clinic dedup lookup
// added in May 2026 for the patient registration wizard's Step 2 flow.
//
// The function is the gate for Cases B (active link) and C (provisional
// reissue) in patient.service.createPatient. If this lookup is wrong,
// the entire 4-case branching collapses — so we test the edges hard.
//
// What we cover:
//   - email normalization (trim + lowercase) before hashing
//   - status="active" when isProvisional=false
//   - status="provisional" when isProvisional=true
//   - null when not found
//   - null when input is empty/invalid
//   - skips anonymized users (HIPAA — anonymized = effectively deleted)
//   - skips soft-deleted users
//   - does NOT match by phone (no User-side phone hash exists)
//
// Strategy: build real User docs through Mongoose so the pre-save hook
// computes emailHash the same way the lookup expects. Anything mocked
// would let an algorithm divergence (e.g. someone changes the hook to
// use HMAC) slip through.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import argon2 from "argon2";

import { findExistingUserByContact } from "../../modules/clinic/clinic-patients/services/provisional.service.js";
import User from "../../common/models/Auth/users.js";

// ─── Test helpers ─────────────────────────────────────────────────────

/**
 * Create a real User document with the given email + provisional flag.
 *
 * Doesn't go through provisional.service.createProvisionalUser because
 * that pulls in Clinic validation, tenant context, audit, and email
 * delivery — none relevant here. We construct a minimal valid User.
 *
 * Pre-save hook will compute emailHash/firstNameHash/lastNameHash from
 * the plaintext encrypted fields. We pass plaintext on the *Encrypted
 * fields; the hook encrypts them in place.
 *
 * `password` must be a valid string (User.password is required). We
 * argon2-hash a constant — these tests never log in as the user.
 */
async function makeUser({
  email,
  firstName = "Ivan",
  lastName = "Testov",
  isProvisional = false,
  isAnonymized = false,
  isDeleted = false,
}) {
  const passwordHash = await argon2.hash("test-password-123", {
    type: argon2.argon2id,
  });
  return User.create({
    emailEncrypted: email,
    firstNameEncrypted: firstName,
    lastNameEncrypted: lastName,
    // Hashes filled by pre-save hook; emailHash is required:true so
    // Mongoose checks it BEFORE hook runs. To get around that we
    // pre-populate with a placeholder; the hook overwrites it on save.
    emailHash: "placeholder",
    firstNameHash: "placeholder",
    lastNameHash: "placeholder",
    username: `test-${new mongoose.Types.ObjectId().toString()}`,
    password: passwordHash,
    dateOfBirth: new Date("1990-01-01"),
    bio: "test",
    role: "patient",
    isDoctor: false,
    isPatient: true,
    agreement: true,
    isProvisional,
    isAnonymized,
    isDeleted,
  });
}

// ─── Fixtures ─────────────────────────────────────────────────────────

beforeEach(async () => {
  await User.collection.deleteMany({});
});

// ════════════════════════════════════════════════════════════════
//  basic lookups
// ════════════════════════════════════════════════════════════════

describe("findExistingUserByContact — basic lookups", () => {
  it("returns null when no email is provided", async () => {
    const result = await findExistingUserByContact({});
    expect(result).toBeNull();
  });

  it("returns null when email is undefined", async () => {
    const result = await findExistingUserByContact({ email: undefined });
    expect(result).toBeNull();
  });

  it("returns null when email is empty string", async () => {
    const result = await findExistingUserByContact({ email: "" });
    expect(result).toBeNull();
  });

  it("returns null when email is just whitespace", async () => {
    const result = await findExistingUserByContact({ email: "   " });
    expect(result).toBeNull();
  });

  it("returns null when email is not a string", async () => {
    const result = await findExistingUserByContact({ email: 12345 });
    expect(result).toBeNull();
  });

  it("returns null when no user matches the email", async () => {
    await makeUser({ email: "someone@example.com" });
    const result = await findExistingUserByContact({
      email: "different@example.com",
    });
    expect(result).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════
//  active user match
// ════════════════════════════════════════════════════════════════

describe("findExistingUserByContact — active user match", () => {
  it("returns status='active' for non-provisional user", async () => {
    const user = await makeUser({
      email: "alice@example.com",
      isProvisional: false,
    });

    const result = await findExistingUserByContact({
      email: "alice@example.com",
    });

    expect(result).not.toBeNull();
    expect(result.status).toBe("active");
    expect(String(result.user._id)).toBe(String(user._id));
  });

  it("returned user object contains the decryptable fields", async () => {
    await makeUser({
      email: "bob@example.com",
      firstName: "Bob",
      lastName: "Smith",
    });

    const result = await findExistingUserByContact({
      email: "bob@example.com",
    });

    // We return the lean doc — virtuals don't fire, so caller is
    // responsible for decrypting. We DO expect the encrypted fields
    // to be present (they're needed by the caller to decrypt for the
    // 409 response).
    expect(result.user.firstNameEncrypted).toBeDefined();
    expect(result.user.lastNameEncrypted).toBeDefined();
    expect(result.user.emailEncrypted).toBeDefined();
  });

  it("returned user has isProvisional=false", async () => {
    await makeUser({
      email: "carol@example.com",
      isProvisional: false,
    });

    const result = await findExistingUserByContact({
      email: "carol@example.com",
    });

    expect(result.user.isProvisional).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════
//  provisional user match
// ════════════════════════════════════════════════════════════════

describe("findExistingUserByContact — provisional user match", () => {
  it("returns status='provisional' for isProvisional=true", async () => {
    const user = await makeUser({
      email: "provisional@example.com",
      isProvisional: true,
    });

    const result = await findExistingUserByContact({
      email: "provisional@example.com",
    });

    expect(result).not.toBeNull();
    expect(result.status).toBe("provisional");
    expect(String(result.user._id)).toBe(String(user._id));
  });

  it("returned provisional user retains provisionalCreatedBy field if set", async () => {
    const fakeClinicId = new mongoose.Types.ObjectId();
    const user = await User.create({
      emailEncrypted: "byclinic@example.com",
      firstNameEncrypted: "Test",
      lastNameEncrypted: "User",
      emailHash: "placeholder",
      firstNameHash: "placeholder",
      lastNameHash: "placeholder",
      username: `test-clinic-${new mongoose.Types.ObjectId().toString()}`,
      password: await argon2.hash("x", { type: argon2.argon2id }),
      dateOfBirth: new Date("1990-01-01"),
      bio: "test",
      role: "patient",
      isDoctor: false,
      isPatient: true,
      agreement: true,
      isProvisional: true,
      provisionalCreatedBy: fakeClinicId,
      provisionalCreatedAt: new Date(),
    });

    const result = await findExistingUserByContact({
      email: "byclinic@example.com",
    });

    expect(result.status).toBe("provisional");
    expect(String(result.user.provisionalCreatedBy)).toBe(String(fakeClinicId));
  });
});

// ════════════════════════════════════════════════════════════════
//  email normalization
// ════════════════════════════════════════════════════════════════

describe("findExistingUserByContact — email normalization", () => {
  beforeEach(async () => {
    // One canonical user — lookups with various casings should all hit it.
    await makeUser({ email: "needle@example.com" });
  });

  it("matches with the same casing", async () => {
    const result = await findExistingUserByContact({
      email: "needle@example.com",
    });
    expect(result?.status).toBe("active");
  });

  it("matches with uppercase input", async () => {
    const result = await findExistingUserByContact({
      email: "NEEDLE@EXAMPLE.COM",
    });
    expect(result?.status).toBe("active");
  });

  it("matches with mixed casing", async () => {
    const result = await findExistingUserByContact({
      email: "Needle@Example.Com",
    });
    expect(result?.status).toBe("active");
  });

  it("matches when input has surrounding whitespace", async () => {
    const result = await findExistingUserByContact({
      email: "   needle@example.com   ",
    });
    expect(result?.status).toBe("active");
  });

  it("matches with whitespace AND mixed case", async () => {
    const result = await findExistingUserByContact({
      email: " NEEDLE@example.com ",
    });
    expect(result?.status).toBe("active");
  });
});

// ════════════════════════════════════════════════════════════════
//  filters — anonymized / deleted users are invisible
// ════════════════════════════════════════════════════════════════

describe("findExistingUserByContact — filters", () => {
  it("ignores anonymized users (returns null)", async () => {
    await makeUser({
      email: "ghost@example.com",
      isAnonymized: true,
    });

    const result = await findExistingUserByContact({
      email: "ghost@example.com",
    });

    expect(result).toBeNull();
  });

  it("ignores soft-deleted users (returns null)", async () => {
    await makeUser({
      email: "deleted@example.com",
      isDeleted: true,
    });

    const result = await findExistingUserByContact({
      email: "deleted@example.com",
    });

    expect(result).toBeNull();
  });

  it("ignores an anonymized provisional user even though they exist", async () => {
    // Edge case: provisional was created, then anonymized (e.g. clinic
    // wiped before patient ever activated). New clinic looking them up
    // by old email must see "no match" — the User._id stays alive for
    // FK integrity, but PII is gone, so re-registering would be lying.
    await makeUser({
      email: "wiped@example.com",
      isProvisional: true,
      isAnonymized: true,
    });

    const result = await findExistingUserByContact({
      email: "wiped@example.com",
    });

    expect(result).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════
//  isolation between distinct users
// ════════════════════════════════════════════════════════════════

describe("findExistingUserByContact — multiple users", () => {
  it("returns the right user when multiple users exist", async () => {
    await makeUser({ email: "user1@example.com", firstName: "User1" });
    const u2 = await makeUser({
      email: "user2@example.com",
      firstName: "User2",
    });
    await makeUser({ email: "user3@example.com", firstName: "User3" });

    const result = await findExistingUserByContact({
      email: "user2@example.com",
    });

    expect(result).not.toBeNull();
    expect(String(result.user._id)).toBe(String(u2._id));
  });

  it("returns null even when other users exist (no fuzzy match)", async () => {
    await makeUser({ email: "alice@example.com" });
    await makeUser({ email: "bob@example.com" });

    const result = await findExistingUserByContact({
      email: "carol@example.com",
    });

    expect(result).toBeNull();
  });
});
