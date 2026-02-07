// common/models/newPatientPolyclinic.js
import mongoose from "mongoose";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import QRCode from "qrcode";
import User from "../Auth/users.js";

/* ============================================================
   CRYPTO HELPERS
============================================================ */
const RAW_KEY = process.env.ENCRYPTION_KEY || "default_secret_key";
const SECRET_KEY = RAW_KEY.padEnd(32, "0").slice(0, 32);

const isIvCipher = (s) =>
  typeof s === "string" && /^[0-9a-fA-F]{32}:[0-9a-fA-F]+$/.test(s);

const encrypt = (text) => {
  if (text == null) return undefined;
  const s = String(text);
  if (!s) return undefined;
  if (isIvCipher(s)) return s;

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(SECRET_KEY),
    iv,
  );
  const encrypted = Buffer.concat([cipher.update(s, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
};

const decrypt = (cipherText) => {
  if (!isIvCipher(cipherText)) return cipherText || undefined;
  try {
    const [ivHex, dataHex] = cipherText.split(":");
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
    return undefined;
  }
};

const sha256Lower = (s) =>
  crypto
    .createHash("sha256")
    .update(String(s || "").toLowerCase())
    .digest("hex");

/* ============================================================
   NORMALIZERS
============================================================ */
const normalizeEmail = (s) =>
  String(s || "")
    .trim()
    .toLowerCase();

const normalizePhone = (s = "") => {
  const raw = String(s || "");
  if (!raw) return "";
  const cleaned = raw.replace(/[^\d+]/g, "");
  const withPlus = cleaned.startsWith("+")
    ? cleaned
    : `+${cleaned.replace(/^(\+)?/, "")}`;
  return /^\+\d{1,15}$/.test(withPlus) ? withPlus : "";
};

const normalizeGender = (v) => {
  if (v == null) return undefined;
  const s = String(v).trim().toLowerCase();

  if (["m", "male", "м", "муж", "kişi", "kisi", "erkek"].includes(s))
    return "male";

  if (
    ["f", "female", "ж", "жен", "qadin", "qadın", "kadin", "kadın"].includes(s)
  )
    return "female";

  if (["other", "другое", "başqa", "baska"].includes(s)) return "other";

  if (["unknown", "неизвестно"].includes(s)) return "unknown";

  return undefined;
};

/* ============================================================
   SCHEMA
============================================================ */
const schema = new mongoose.Schema(
  {
    patientUUID: { type: String, default: uuidv4, unique: true },
    patientId: { type: String, required: true, unique: true },

    qrCode: { type: String },

    linkedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      unique: true,
      sparse: true,
    },
    migrationStatus: {
      type: String,
      enum: ["private", "self_registered", "imported", "migrated"],
      index: true,
    },

    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },

    doctorId: [
      { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    ],

    /* encrypted FIO */
    firstNameEncrypted: { type: String, index: true },
    firstNameHash: { type: String, index: true },

    lastNameEncrypted: { type: String, index: true },
    lastNameHash: { type: String, index: true },

    /* encrypted email/phone */
    emailEncrypted: { type: String, required: true, unique: true },
    emailHash: { type: String, required: true, unique: true },

    phoneEncrypted: { type: String, default: undefined },
    phoneHash: { type: String, unique: true, sparse: true },

    bio: { type: String, default: "", maxlength: 500 },

    birthDate: { type: Date, required: true },
    identityDocument: { type: String, required: true, unique: true },

    country: String,
    chronicDiseases: String,
    operations: String,
    familyHistoryOfDisease: String,
    allergies: String,
    immunization: String,
    badHabits: String,
    about: String,
    address: String,

    photo: { type: String, default: null },
    status: { type: String, default: "Pending" },
    paymentStatus: { type: String, default: "Pending" },
    isConsentGiven: { type: Boolean, default: false },

    isVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      getters: true,
      transform: (_, ret) => {
        delete ret.emailEncrypted;
        delete ret.phoneEncrypted;
        delete ret.firstNameEncrypted;
        delete ret.lastNameEncrypted;
        return ret;
      },
    },
    toObject: { virtuals: true, getters: true },
    strict: true,
  },
);

/* ============================================================
   INDEXES (как у тебя, ничего не меняю)
============================================================ */
schema.index(
  { phoneEncrypted: 1 },
  {
    unique: true,
    partialFilterExpression: { phoneEncrypted: { $type: "string" } },
  },
);
schema.index({ phoneHash: 1 }, { unique: true, sparse: true });
schema.index({ doctorId: 1, createdAt: -1 });
schema.index({ firstNameHash: 1 });
schema.index({ lastNameHash: 1 });

/* ============================================================
   SETTERS + GETTERS
============================================================ */
schema.path("emailEncrypted").set(function (val) {
  if (!val) {
    this.emailHash = undefined;
    return undefined;
  }
  const raw = normalizeEmail(val);
  this.emailHash = sha256Lower(raw);
  return encrypt(raw);
});

schema.path("phoneEncrypted").set(function (val) {
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

schema.path("emailEncrypted").get((v) => decrypt(v));
schema.path("phoneEncrypted").get((v) => decrypt(v));

/* ============================================================
   VIRTUALS
============================================================ */
schema
  .virtual("firstName")
  .get(function () {
    return this.firstNameEncrypted
      ? decrypt(this.firstNameEncrypted)
      : undefined;
  })
  .set(function (val) {
    const plain = val ? String(val).trim() : "";
    if (!plain) {
      this.firstNameEncrypted = undefined;
      this.firstNameHash = undefined;
    } else {
      this.firstNameEncrypted = encrypt(plain);
      this.firstNameHash = sha256Lower(plain);
    }
  });

schema
  .virtual("lastName")
  .get(function () {
    return this.lastNameEncrypted ? decrypt(this.lastNameEncrypted) : undefined;
  })
  .set(function (val) {
    const plain = val ? String(val).trim() : "";
    if (!plain) {
      this.lastNameEncrypted = undefined;
      this.lastNameHash = undefined;
    } else {
      this.lastNameEncrypted = encrypt(plain);
      this.lastNameHash = sha256Lower(plain);
    }
  });

schema
  .virtual("email")
  .get(function () {
    return this.emailEncrypted;
  })
  .set(function (val) {
    this.emailEncrypted = val;
  });

schema
  .virtual("phoneNumber")
  .get(function () {
    return this.phoneEncrypted;
  })
  .set(function (val) {
    this.phoneEncrypted = val;
  });

schema.virtual("fullName").get(function () {
  return `${this.firstName || ""} ${this.lastName || ""}`.trim();
});

/* ============================================================
   HOOKS
============================================================ */
schema.pre("validate", async function (next) {
  try {
    // ===============================
    // REQUIRED FIELDS CHECK
    // ===============================
    if (!this.firstNameEncrypted || !this.lastNameEncrypted) {
      return next(new Error("firstName and lastName are required"));
    }

    // ===============================
    // UUID & QR
    // ===============================
    if (!this.patientUUID) this.patientUUID = uuidv4();
    if (!this.qrCode) {
      this.qrCode = await QRCode.toDataURL(this.patientUUID);
    }

    // ===============================
    // MIGRATION STATUS LOGIC
    // ===============================
    if (!this.linkedUserId) {
      // создаётся врачом
      this.migrationStatus = "private";
    } else {
      // уже привязан к User
      this.migrationStatus = "migrated";
    }

    next();
  } catch (e) {
    next(e);
  }
});

/* Hash recovery */
schema.pre("save", function (next) {
  if (this.isModified("firstNameEncrypted") && !this.firstNameHash) {
    const plain = decrypt(this.firstNameEncrypted);
    this.firstNameHash = plain ? sha256Lower(plain) : undefined;
  }

  if (this.isModified("lastNameEncrypted") && !this.lastNameHash) {
    const plain = decrypt(this.lastNameEncrypted);
    this.lastNameHash = plain ? sha256Lower(plain) : undefined;
  }

  next();
});

/* isActive from User */
schema.pre("save", async function (next) {
  if (this.linkedUserId) {
    const user = await User.findById(this.linkedUserId);
    this.isActive = user?.role === "patient";
  }
  next();
});

/* Gender, name, and encrypted field normalization in updates */
function getSetObj(update) {
  if (!update || typeof update !== "object") return {};
  if (update.$set && typeof update.$set === "object") return update.$set;
  return update;
}

schema.pre("findOneAndUpdate", function (next) {
  const update = this.getUpdate() || {};
  const $set = getSetObj(update);

  if ($set.firstName != null && !$set.firstNameEncrypted) {
    const plain = String($set.firstName).trim();
    $set.firstNameEncrypted = plain ? encrypt(plain) : undefined;
    $set.firstNameHash = plain ? sha256Lower(plain) : undefined;
    delete $set.firstName;
  }

  if ($set.lastName != null && !$set.lastNameEncrypted) {
    const plain = String($set.lastName).trim();
    $set.lastNameEncrypted = plain ? encrypt(plain) : undefined;
    $set.lastNameHash = plain ? sha256Lower(plain) : undefined;
    delete $set.lastName;
  }

  if ($set.emailEncrypted != null) {
    const raw = normalizeEmail($set.emailEncrypted);
    $set.emailEncrypted = encrypt(raw);
    $set.emailHash = sha256Lower(raw);
  }

  if ($set.phoneEncrypted != null) {
    const normalized = normalizePhone($set.phoneEncrypted);
    $set.phoneEncrypted = normalized ? encrypt(normalized) : undefined;
    $set.phoneHash = normalized ? sha256Lower(normalized) : undefined;
  }

  if ($set.gender != null) {
    const raw = String($set.gender).trim();
    const norm = normalizeGender(raw);

    if (norm) {
      $set.gender = norm;
    } else {
      if ($set.bio == null) $set.bio = raw;
      delete $set.gender;
    }
  }

  if (update.$set) {
    this.setUpdate({ ...update, $set });
  } else {
    this.setUpdate($set);
  }

  next();
});

/* ============================================================
   FIXED: allowCreate only for NEW documents
============================================================ */
schema.pre("save", function (next) {
  if (this.isNew) {
    if (!this.$locals?.allowCreate) {
      return next(
        new Error(
          "Creation of NewPatientPolyclinic requires $locals.allowCreate=true",
        ),
      );
    }
  }
  next();
});

/* InsertMany guard */
schema.pre("insertMany", function (next, docs) {
  const bad = (docs || []).filter((d) => !d.$locals?.allowCreate);
  if (bad.length) {
    return next(
      new Error("insertMany requires $locals.allowCreate=true on each doc"),
    );
  }
  next();
});

/* Upsert guard */
schema.pre("findOneAndUpdate", function (next) {
  const opts = this.getOptions?.() || {};
  if (opts.upsert) {
    return next(
      new Error(
        "Upsert to NewPatientPolyclinic is disabled. Use explicit create with $locals.allowCreate=true",
      ),
    );
  }
  next();
});

/* ============================================================
   MODEL
============================================================ */
const NewPatientPolyclinic =
  mongoose.models.NewPatientPolyclinic ||
  mongoose.model("NewPatientPolyclinic", schema);

/* alias for populate("Patient") */
if (!mongoose.models.Patient) {
  mongoose.model("Patient", schema);
}

export default NewPatientPolyclinic;
