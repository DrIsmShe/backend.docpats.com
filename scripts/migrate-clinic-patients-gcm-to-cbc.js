// server/scripts/migrate-clinic-patients-gcm-to-cbc.js
//
// One-time migration: clinic_patients collection from GCM+SURGERY_ENCRYPTION_KEY
// to CBC+ENCRYPTION_KEY (Sprint Cleanup unification).
//
// Idempotent: detects format by `:` part count — 3 parts = old GCM (migrate),
// 2 parts = new CBC (skip).
//
// Usage:
//   cd server
//   node scripts/migrate-clinic-patients-gcm-to-cbc.js
//
// Safe to run multiple times. Will report counts at the end.

import "dotenv/config";
import mongoose from "mongoose";
import crypto from "crypto";

const MONGO_URL = process.env.MONGO_URL;
const OLD_KEY_HEX = process.env.SURGERY_ENCRYPTION_KEY;
const NEW_RAW_KEY = process.env.ENCRYPTION_KEY;

if (!MONGO_URL) throw new Error("MONGO_URL required");
if (!OLD_KEY_HEX || OLD_KEY_HEX.length !== 64) {
  throw new Error("SURGERY_ENCRYPTION_KEY must be 64 hex chars");
}
if (!NEW_RAW_KEY) throw new Error("ENCRYPTION_KEY required");

const OLD_KEY = Buffer.from(OLD_KEY_HEX, "hex");
const NEW_KEY = Buffer.from(NEW_RAW_KEY.padEnd(32, "0").slice(0, 32), "utf8");

// ─── Old format (GCM) decrypt ─────────────────────────────────────────
function decryptOldGcm(payload) {
  if (!payload || typeof payload !== "string") return null;
  const parts = payload.split(":");
  if (parts.length !== 3) return null; // not GCM format
  try {
    const [ivHex, tagHex, dataHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(tagHex, "hex");
    const data = Buffer.from(dataHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", OLD_KEY, iv);
    decipher.setAuthTag(authTag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return dec.toString("utf8");
  } catch (err) {
    return null;
  }
}

// ─── New format (CBC) encrypt ─────────────────────────────────────────
function encryptNewCbc(plain) {
  if (plain === null || plain === undefined || plain === "") return null;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", NEW_KEY, iv);
  const enc = Buffer.concat([
    cipher.update(String(plain), "utf8"),
    cipher.final(),
  ]);
  return `${iv.toString("hex")}:${enc.toString("hex")}`;
}

// ─── New HMAC with NEW key ────────────────────────────────────────────
function hashNew(plain) {
  if (plain === null || plain === undefined || plain === "") return null;
  const normalized = String(plain).trim().toLowerCase();
  return crypto.createHmac("sha256", NEW_KEY).update(normalized).digest("hex");
}

// ─── Format detection ─────────────────────────────────────────────────
function isOldGcmFormat(v) {
  return typeof v === "string" && v.split(":").length === 3;
}

const ENCRYPTED_FIELDS = [
  "firstNameEncrypted",
  "lastNameEncrypted",
  "phoneEncrypted",
  "emailEncrypted",
  "notesEncrypted",
];

async function migrate() {
  console.log("[migrate] Connecting to MongoDB...");
  await mongoose.connect(MONGO_URL);
  const db = mongoose.connection.db;
  const coll = db.collection("clinic_patients");

  const total = await coll.countDocuments({});
  console.log(`[migrate] Total clinic_patients docs: ${total}`);

  if (total === 0) {
    console.log("[migrate] Nothing to migrate.");
    await mongoose.disconnect();
    return;
  }

  const cursor = coll.find({});
  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  const failures = [];

  for await (const doc of cursor) {
    // Check if ANY encrypted field is still in old format
    const needsMigration = ENCRYPTED_FIELDS.some((f) => isOldGcmFormat(doc[f]));

    if (!needsMigration) {
      skipped++;
      continue;
    }

    try {
      const update = {};

      // Re-encrypt each PHI field
      for (const field of ENCRYPTED_FIELDS) {
        if (!doc[field]) continue;
        if (!isOldGcmFormat(doc[field])) continue; // already migrated

        const plain = decryptOldGcm(doc[field]);
        if (plain === null) {
          throw new Error(`Failed to decrypt field "${field}"`);
        }
        update[field] = encryptNewCbc(plain);
      }

      // Recompute blind-index hashes if phone/email were present
      if (doc.phoneEncrypted && isOldGcmFormat(doc.phoneEncrypted)) {
        const phonePlain = decryptOldGcm(doc.phoneEncrypted);
        update.phoneHash = hashNew(phonePlain);
      }
      if (doc.emailEncrypted && isOldGcmFormat(doc.emailEncrypted)) {
        const emailPlain = decryptOldGcm(doc.emailEncrypted);
        update.emailHash = hashNew(emailPlain);
      }

      await coll.updateOne({ _id: doc._id }, { $set: update });
      migrated++;

      if (migrated % 100 === 0) {
        console.log(
          `[migrate] Progress: ${migrated} migrated, ${skipped} skipped, ${failed} failed`,
        );
      }
    } catch (err) {
      failed++;
      failures.push({ _id: doc._id.toString(), error: err.message });
      console.error(`[migrate] FAIL _id=${doc._id}: ${err.message}`);
    }
  }

  console.log("\n=== MIGRATION SUMMARY ===");
  console.log(`Total docs:      ${total}`);
  console.log(`Migrated:        ${migrated}`);
  console.log(`Skipped (new):   ${skipped}`);
  console.log(`Failed:          ${failed}`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  _id=${f._id} | ${f.error}`));
  }

  await mongoose.disconnect();
  console.log("[migrate] Done.");
}

migrate().catch((err) => {
  console.error("[migrate] FATAL:", err);
  process.exit(1);
});
