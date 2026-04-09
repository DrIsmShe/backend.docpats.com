import mongoose from "mongoose";
import crypto from "crypto";
import "dotenv/config";
import { decrypt } from "../../../common/models/Auth/users.js"; // ты уже экспортируешь decrypt

const RAW_KEY = process.env.ENCRYPTION_KEY || "";
const SECRET_KEY = RAW_KEY.padEnd(32, "0").slice(0, 32);

const isEncrypted = (v) => typeof v === "string" && v.includes(":");
const encrypt = (value) => {
  if (value == null) return value;
  const s = String(value);
  if (!s) return s;
  if (isEncrypted(s)) return s;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(SECRET_KEY),
    iv,
  );
  const encrypted = Buffer.concat([cipher.update(s, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
};
const sha256 = (v) =>
  v == null ? v : crypto.createHash("sha256").update(String(v)).digest("hex");

const DoctorVerificationSchema = new mongoose.Schema(
  {
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    profile: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DoctorProfile",
      required: true,
    },

    jurisdictionCode: { type: String, required: true, index: true }, // AZ, TR, US-CA
    country: { type: String, required: true, index: true }, // для UI

    license: {
      type: {
        type: String,
        enum: ["medical", "temporary", "specialist"],
        default: "medical",
      },
      numberEncrypted: { type: String, required: true },
      numberHash: { type: String, required: true, index: true },
      issuedAt: { type: Date, default: null },
      expiresAt: { type: Date, default: null },
      authorityName: { type: String, default: null },
    },

    verificationLevel: {
      type: String,
      enum: ["unverified", "basic", "full"],
      default: "unverified",
      index: true,
    },

    status: {
      type: String,
      enum: [
        "draft",
        "pending",
        "clarification_required",
        "approved",
        "rejected",
        "suspended",
        "expired",
      ],
      default: "draft",
      index: true,
    },

    submittedAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    reVerificationDueAt: { type: Date, default: null },

    // после submit поля становятся "замороженными"
    locked: { type: Boolean, default: false },

    documents: [
      {
        type: {
          type: String,
          enum: ["diploma", "license", "specialization", "selfie"],
          required: true,
        },
        file: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "File",
          required: true,
        },
        fileHash: { type: String, required: true },
        uploadedAt: { type: Date, default: Date.now },
        verified: { type: Boolean, default: false },
      },
    ],

    review: {
      reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      reviewedAt: { type: Date, default: null },

      decision: {
        type: String,
        enum: ["approved", "rejected", "clarification_required"],
        default: null,
      },

      evidenceChecked: { type: [String], default: [] }, // очень важно для compliance
      notes: { type: String, default: null },

      rejectionReason: { type: String, default: null },
      clarificationMessage: { type: String, default: null },
    },

    risk: {
      flags: { type: [String], default: [] },
      riskScore: { type: Number, default: 0 },
      underInvestigation: { type: Boolean, default: false },
    },

    history: [
      {
        action: { type: String, required: true },
        by: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null,
        },
        at: { type: Date, default: Date.now },
        note: { type: String, default: null },
      },
    ],
  },
  { timestamps: true },
);

// шифруем номер лицензии и считаем hash
DoctorVerificationSchema.pre("validate", function (next) {
  if (this.isModified("license.numberEncrypted")) {
    const plain = decrypt(this.license.numberEncrypted); // если вдруг пришло уже encrypted — decrypt вернёт норм
    const safePlain = plain ?? this.license.numberEncrypted;

    this.license.numberEncrypted = encrypt(safePlain);
    this.license.numberHash = sha256(safePlain);
  }
  next();
});

// запрет редактирования ключевых полей, если locked=true
DoctorVerificationSchema.pre("save", function (next) {
  if (!this.isModified("locked")) {
    if (this.locked) {
      const forbidden = [
        "jurisdictionCode",
        "country",
        "license",
        "verificationLevel",
        "documents",
      ];

      // если кто-то пытается менять ключевые поля после submit
      for (const f of forbidden) {
        if (this.isModified(f)) {
          return next(new Error(`Verification is locked. Cannot modify: ${f}`));
        }
      }
    }
  }
  next();
});

const DoctorVerification =
  mongoose.models.DoctorVerification ||
  mongoose.model("DoctorVerification", DoctorVerificationSchema);

export default DoctorVerification;
