// server/modules/communication/messages/message.model.js
//
// ChatMessage model — encrypted at-rest message text for doctor-patient chat.
//
// Encryption strategy (Sprint Cleanup 17.05.2026 — unified across DocPats):
//   - textEncrypted is encrypted with ENCRYPTION_KEY (AES-256-CBC,
//     "iv:ciphertext" hex format). Same algorithm as User PHI,
//     ClinicPatient, ClinicAppointment.
//   - Inline crypto helper — no dependency on simulation module.
//   - Exports: encryptMessageText (used by service for new messages),
//     safeDecrypt (used by mapper for lean queries).
//
// HIPAA §164.312(a)(2)(iv): PHI encrypted at rest. ✓

import mongoose from "mongoose";
import crypto from "crypto";

const { Schema } = mongoose;

// ─── Crypto helpers ────────────────────────────────────────────────────

const ALGO = "aes-256-cbc";
const RAW_KEY = process.env.ENCRYPTION_KEY || "";

if (!RAW_KEY) {
  throw new Error("[message.model] ENCRYPTION_KEY must be set in environment");
}

// Pad/truncate to exactly 32 bytes — consistent with User model and
// clinicPatient.model.js across the codebase.
const KEY = Buffer.from(RAW_KEY.padEnd(32, "0").slice(0, 32), "utf8");

/**
 * Encrypt plain text → "iv:ciphertext" (all hex).
 * Returns null for null/undefined/empty input.
 */
function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === "") {
    return null;
  }
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const enc = Buffer.concat([
    cipher.update(String(plaintext), "utf8"),
    cipher.final(),
  ]);
  return `${iv.toString("hex")}:${enc.toString("hex")}`;
}

/**
 * Decrypt "iv:ciphertext" → plaintext.
 * Throws on malformed input — caller chooses strict vs safe.
 */
function decrypt(payload) {
  if (payload === null || payload === undefined || payload === "") {
    return null;
  }
  if (typeof payload !== "string") {
    throw new TypeError("[message.model] decrypt expects a string");
  }
  const parts = payload.split(":");
  if (parts.length !== 2) {
    throw new Error("[message.model] malformed ciphertext (expected iv:data)");
  }
  const [ivHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const data = Buffer.from(dataHex, "hex");
  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString("utf8");
}

/**
 * Safe-decrypt: never throws. Returns fallback on any failure.
 * Used by mapper for listing endpoints — one corrupt message
 * must not kill the entire response.
 */
export function safeDecrypt(payload, fallback = "") {
  try {
    const v = decrypt(payload);
    return v === null ? fallback : v;
  } catch (err) {
    console.warn("[message.model] safeDecrypt failed:", err.message);
    return fallback;
  }
}

/**
 * Helper for service layer: encrypts plaintext, returns the
 * payload string ready to be stored in `textEncrypted`.
 * Returns null for empty/whitespace-only input (file/voice-only messages).
 */
export function encryptMessageText(plainText) {
  if (!plainText || typeof plainText !== "string" || !plainText.trim()) {
    return null;
  }
  return encrypt(plainText);
}

// ─── Schema ────────────────────────────────────────────────────────────

export const MESSAGE_TYPES = [
  "text",
  "file",
  "image",
  "video",
  "voice",
  "system",
];

const MessageSchema = new Schema(
  {
    dialogId: {
      type: Schema.Types.ObjectId,
      ref: "ChatDialog",
      required: true,
      index: true,
    },
    replyTo: {
      type: Schema.Types.ObjectId,
      ref: "ChatMessage",
      default: null,
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: MESSAGE_TYPES,
      required: true,
      default: "text",
      index: true,
    },

    // ── Legacy plaintext field. Old messages (pre-migration) live here.
    // After full cleanup, this field will be removed from all docs.
    text: {
      type: String,
      trim: true,
    },

    // ── Encrypted text (HIPAA § 164.312(a)(2)(iv) — encryption at rest).
    // Format: "iv:ciphertext" (all hex), AES-256-CBC.
    // Key: ENCRYPTION_KEY from env (unified Sprint Cleanup 17.05.2026).
    textEncrypted: {
      type: String,
      default: null,
    },

    // Reply / threading
    replyToMessageId: {
      type: Schema.Types.ObjectId,
      ref: "ChatMessage",
    },

    // System messages
    systemCode: {
      type: String,
      trim: true,
    },

    meta: {
      type: Schema.Types.Mixed,
      default: {},
    },

    reactions: [
      {
        emoji: { type: String, required: true },
        userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
      },
    ],

    readBy: [
      {
        userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
        readAt: { type: Date, default: Date.now },
      },
    ],

    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
    },
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
);

// ─── Virtual "decryptedText" ───────────────────────────────────────────
// Read-only: returns decrypted text OR legacy plain `text`.
// Used by mapper as msg.decryptedText. NEVER exposes ciphertext outward.
//
// safeDecrypt — if decryption fails (corrupt record, key rotation without
// migration), returns "" instead of crashing the whole response.
MessageSchema.virtual("decryptedText").get(function () {
  if (this.textEncrypted) return safeDecrypt(this.textEncrypted, "");
  return this.text || null;
});

MessageSchema.set("toJSON", { virtuals: true });
MessageSchema.set("toObject", { virtuals: true });

MessageSchema.virtual("attachments", {
  ref: "MessageAttachment",
  localField: "_id",
  foreignField: "messageId",
});

const ChatMessageModel =
  mongoose.models.ChatMessage ||
  mongoose.model("ChatMessage", MessageSchema, "messages");

export default ChatMessageModel;
