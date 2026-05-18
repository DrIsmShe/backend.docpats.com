// server/scripts/migrate-clinic-appointments-gcm-to-cbc.js
//
// One-time migration: clinic_appointments.reasonEncrypted from
// GCM+SURGERY_ENCRYPTION_KEY to CBC+ENCRYPTION_KEY.
//
// Same pattern as migrate-clinic-patients-gcm-to-cbc.js — only difference
// is single PHI field (reasonEncrypted) and no blind-index hash.
//
// Idempotent: 3-part = GCM (migrate), 2-part = CBC (skip).

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

function decryptOldGcm(payload) {
  if (!payload || typeof payload !== "string") return null;
  const parts = payload.split(":");
  if (parts.length !== 3) return null;
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

function isOldGcmFormat(v) {
  return typeof v === "string" && v.split(":").length === 3;
}

async function migrate() {
  console.log("[migrate] Connecting to MongoDB...");
  await mongoose.connect(MONGO_URL);
  const coll = mongoose.connection.db.collection("clinic_appointments");

  const total = await coll.countDocuments({});
  console.log(`[migrate] Total clinic_appointments docs: ${total}`);

  const cursor = coll.find({
    reasonEncrypted: { $exists: true, $nin: [null, ""] },
  });

  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  const failures = [];

  for await (const doc of cursor) {
    if (!isOldGcmFormat(doc.reasonEncrypted)) {
      skipped++;
      continue;
    }
    try {
      const plain = decryptOldGcm(doc.reasonEncrypted);
      if (plain === null) {
        throw new Error("Failed to decrypt reasonEncrypted with OLD key");
      }
      const newEncrypted = encryptNewCbc(plain);
      await coll.updateOne(
        { _id: doc._id },
        { $set: { reasonEncrypted: newEncrypted } },
      );
      migrated++;
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
