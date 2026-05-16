// __tests__/helpers/createTestUser.js
//
// Test fixture helper — creates a real User document in the in-memory DB
// that satisfies the controller's authorization checks.
//
// Why this exists:
//   The clinic.controller.js createClinic endpoint (after the day-10
//   security fix) loads the User from DB and verifies:
//     - user exists
//     - user.isBlocked === false
//     - user.isDoctor === true
//   Tests that just mock req.session.userId without seeding a matching
//   User now get rejected with UnauthorizedError ("User not found") —
//   that's the source of the unexpected 401 responses in the
//   clinic-endpoints integration tests.
//
// IMPLEMENTATION NOTE:
//   The User schema declares emailHash / firstNameHash / lastNameHash as
//   REQUIRED. Mongoose validates required fields BEFORE running pre("save")
//   hooks — so we can't rely on the hook to derive hashes from *Encrypted
//   fields. We have to pre-compute and pass them explicitly.
//
//   We also pre-encrypt the *Encrypted fields here (the same AES-256-CBC
//   round-trip the model uses) so the data round-trips correctly if
//   anything in the test path decrypts them later.

import crypto from "crypto";
import mongoose from "mongoose";
import User from "../../common/models/Auth/users.js";

const RAW_KEY = process.env.ENCRYPTION_KEY || "";
const SECRET_KEY = RAW_KEY.padEnd(32, "0").slice(0, 32);

function encrypt(plain) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(SECRET_KEY),
    iv,
  );
  const enc = Buffer.concat([
    cipher.update(String(plain), "utf8"),
    cipher.final(),
  ]);
  return `${iv.toString("hex")}:${enc.toString("hex")}`;
}

function sha256(v) {
  return crypto.createHash("sha256").update(String(v)).digest("hex");
}

const normalizeEmail = (s) => String(s).trim().toLowerCase();
const normalizeName = (s) => String(s).trim();

/**
 * Create a doctor user that can pass the createClinic guard.
 *
 * @param {object} [overrides] - any User fields to override
 * @returns {Promise<{user: User, userId: mongoose.Types.ObjectId}>}
 */
export async function createTestDoctor(overrides = {}) {
  const userId = overrides._id || new mongoose.Types.ObjectId();
  // Unique suffix per user so multiple test users don't collide on the
  // unique indexes (emailHash, username).
  const suffix = userId.toString().slice(-8);

  const emailPlain = `test-doctor-${suffix}@docpats.test`;
  const firstNamePlain = "Test";
  const lastNamePlain = `Doctor${suffix}`;

  const user = await User.create({
    _id: userId,
    // Encrypted fields — pre-encrypted so they match the schema's storage
    // format. The model's pre-save hook will detect they're already
    // encrypted (contain ":") and skip re-encryption.
    emailEncrypted: encrypt(emailPlain),
    firstNameEncrypted: encrypt(firstNamePlain),
    lastNameEncrypted: encrypt(lastNamePlain),
    // Hashes — REQUIRED at validation time, which runs BEFORE pre-save
    // hooks. We must compute and pass them here.
    emailHash: sha256(normalizeEmail(emailPlain)),
    firstNameHash: sha256(normalizeName(firstNamePlain)),
    lastNameHash: sha256(normalizeName(lastNamePlain)),
    // Required scalars
    password: "hashed-test-password-not-real",
    username: `test_doc_${suffix}`,
    dateOfBirth: new Date("1980-01-01"),
    bio: "Test doctor bio",
    role: "doctor",
    isDoctor: true,
    isPatient: false,
    isBlocked: false,
    agreement: true,
    ...overrides,
  });

  return { user, userId };
}
