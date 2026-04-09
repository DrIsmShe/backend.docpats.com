import mongoose from "mongoose";
import crypto from "crypto";

/* ======================================================
   CRYPTO
====================================================== */
const RAW_KEY = process.env.ENCRYPTION_KEY || "";
const SECRET_KEY = RAW_KEY.padEnd(32, "0").slice(0, 32);

const isEncrypted = (v) => typeof v === "string" && v.includes(":");
const { Schema } = mongoose;
const encrypt = (value) => {
  if (value == null) return undefined;
  const s = String(value).trim();
  if (!s) return undefined;
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

const decrypt = (value) => {
  if (!isEncrypted(value)) return value;
  try {
    const [ivHex, dataHex] = value.split(":");
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(SECRET_KEY),
      Buffer.from(ivHex, "hex"),
    );
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
};

const sha256Lower = (v) =>
  crypto
    .createHash("sha256")
    .update(
      String(v || "")
        .trim()
        .toLowerCase(),
    )
    .digest("hex");

/* ======================================================
   ENUMS
====================================================== */
const GENDER_ENUM = ["male", "female", "other", "unknown"];

const MIGRATION_STATUS = ["private", "linked", "migrated"];

const LINK_STATUS_ENUM = [
  "none", // нет попыток связать с аккаунтом
  "suggested", // система/врач предложили связать
  "linked", // уже привязан к реальному пациентскому аккаунту
  "rejected", // врач/пациент отказались связывать
];

/* ======================================================
   SCHEMA
====================================================== */
const DoctorPrivatePatientSchema = new mongoose.Schema(
  {
    /* ---------------------------------
       OWNER
    --------------------------------- */
    doctorProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DoctorProfile",
      required: true,
      index: true,
    },

    doctorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },

    /* ---------------------------------
       IDENTITY (encrypted)
    --------------------------------- */
    firstNameEncrypted: { type: String, required: true },
    firstNameHash: { type: String, index: true },

    lastNameEncrypted: { type: String, required: true },
    lastNameHash: { type: String, index: true },

    emailEncrypted: { type: String },
    emailHash: { type: String, index: true, sparse: true },

    phoneEncrypted: { type: String },
    phoneHash: { type: String, index: true, sparse: true },

    gender: { type: String, enum: GENDER_ENUM, default: "unknown" },
    dateOfBirth: Date,

    externalId: { type: String, trim: true },

    /* ---------------------------------
       ADDRESS
    --------------------------------- */
    address: {
      country: String,
      city: String,
      street: String,
      house: String,
      apartment: String,
    },

    /* ---------------------------------
       MEDICAL
    --------------------------------- */
    medicalProfile: {
      immunization: String,
      allergies: String,
      chronicDiseases: String,
      familyHistoryOfDisease: String,
      operations: String,
      badHabits: String,
      about: String,
    },

    mainDiagnosisText: String,
    mainDiagnosisCode: String,
    mainComplaint: String,
    tags: [String],
    notes: String,

    image: String,

    /* ---------------------------------
       LINK & MIGRATION
    --------------------------------- */
    migrationStatus: {
      type: String,
      enum: MIGRATION_STATUS,
      default: "private",
      index: true,
    },

    linkedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },

    linkedPatientProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NewPatientPolyclinic",
      index: true,
    },

    migratedAt: Date,

    // История попыток "слияния" / привязки
    linkHistory: [
      {
        status: {
          type: String,
          enum: LINK_STATUS_ENUM,
        },
        changedAt: {
          type: Date,
          default: Date.now,
        },
        changedBy: {
          type: Schema.Types.ObjectId,
          ref: "User", // кто менял статус
        },
        comment: {
          type: String,
          trim: true,
        },
      },
    ],

    // -----------------------------------
    // 6. Статусы и управление списком
    // -----------------------------------
    isFavorite: {
      type: Boolean,
      default: false, // для "избранных" пациентов в списке
    },

    isArchived: {
      type: Boolean,
      default: false, // если пациент больше не наблюдается
      index: true,
    },

    archivedAt: {
      type: Date,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },

    deletedAt: {
      type: Date,
    },

    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    archiveReason: {
      type: String,
      trim: true,
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_, ret) => {
        delete ret.firstNameEncrypted;
        delete ret.lastNameEncrypted;
        delete ret.emailEncrypted;
        delete ret.phoneEncrypted;
        delete ret.firstNameHash;
        delete ret.lastNameHash;
        delete ret.emailHash;
        delete ret.phoneHash;
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

/* ======================================================
   SETTERS
====================================================== */
/* ======================================================
   NORMALIZERS
====================================================== */
const normalizePhone = (s = "") => {
  const raw = String(s || "");
  const cleaned = raw.replace(/[^\d]/g, "");
  return cleaned ? `+${cleaned}` : "";
};

/* ======================================================
   SETTERS
====================================================== */

DoctorPrivatePatientSchema.path("emailEncrypted").set(function (val) {
  if (!val) {
    this.emailHash = undefined;
    return undefined;
  }
  const plain = String(val).trim().toLowerCase();
  this.emailHash = sha256Lower(plain);
  return encrypt(plain);
});

DoctorPrivatePatientSchema.path("phoneEncrypted").set(function (val) {
  if (!val) {
    this.phoneHash = undefined;
    return undefined;
  }

  const normalized = normalizePhone(val);

  if (!normalized) {
    this.phoneHash = undefined;
    return undefined;
  }

  this.phoneHash = sha256Lower(normalized);
  return encrypt(normalized);
});

/* ======================================================
   VIRTUALS
====================================================== */
DoctorPrivatePatientSchema.virtual("firstName")
  .get(function () {
    return decrypt(this.firstNameEncrypted);
  })
  .set(function (v) {
    const plain = String(v || "").trim();
    this.firstNameEncrypted = encrypt(plain);
    this.firstNameHash = sha256Lower(plain);
  });

DoctorPrivatePatientSchema.virtual("lastName")
  .get(function () {
    return decrypt(this.lastNameEncrypted);
  })
  .set(function (v) {
    const plain = String(v || "").trim();
    this.lastNameEncrypted = encrypt(plain);
    this.lastNameHash = sha256Lower(plain);
  });

DoctorPrivatePatientSchema.virtual("email")
  .get(function () {
    return decrypt(this.emailEncrypted);
  })
  .set(function (v) {
    this.emailEncrypted = v;
  });

DoctorPrivatePatientSchema.virtual("phoneNumber")
  .get(function () {
    return decrypt(this.phoneEncrypted);
  })
  .set(function (v) {
    this.phoneEncrypted = v;
  });

DoctorPrivatePatientSchema.virtual("fullName").get(function () {
  return `${this.firstName || ""} ${this.lastName || ""}`.trim();
});

/* ======================================================
   MIGRATION HELPER
====================================================== */
DoctorPrivatePatientSchema.methods.prepareForMigration = function () {
  return {
    firstName: this.firstName,
    lastName: this.lastName,
    email: this.email,
    phoneNumber: this.phoneNumber,
    gender: this.gender,
    birthDate: this.dateOfBirth,
    medicalProfile: this.medicalProfile,
    address: this.address,
  };
};

/* ======================================================
   INDEXES
====================================================== */
DoctorPrivatePatientSchema.index({ doctorProfileId: 1, isArchived: 1 });
DoctorPrivatePatientSchema.index({ doctorProfileId: 1, phoneHash: 1 });
DoctorPrivatePatientSchema.index({ doctorUserId: 1, emailHash: 1 });
DoctorPrivatePatientSchema.index({ doctorUserId: 1, phoneHash: 1 });
/* ======================================================
   MODEL
====================================================== */

const DoctorPrivatePatient =
  mongoose.models.DoctorPrivatePatient ||
  mongoose.model(
    "DoctorPrivatePatient",
    DoctorPrivatePatientSchema,
    "doctor_private_patients",
  );

export default DoctorPrivatePatient;
