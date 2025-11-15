// common/models/newPatientPolyclinic.js
import mongoose from "mongoose";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import QRCode from "qrcode";
import User from "../Auth/users.js";

/* ========== Crypto helpers ========== */
const RAW_KEY = process.env.ENCRYPTION_KEY || "default_secret_key";
const SECRET_KEY = RAW_KEY.padEnd(32, "0").slice(0, 32);

const isIvCipher = (s) =>
  typeof s === "string" && /^[0-9a-fA-F]{32}:[0-9a-fA-F]+$/.test(s);

const encrypt = (text) => {
  if (text == null) return undefined;
  const s = String(text);
  if (!s) return undefined;
  if (isIvCipher(s)) return s; // уже зашифровано
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(SECRET_KEY),
    iv
  );
  const encrypted = Buffer.concat([cipher.update(s, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
};

const decrypt = (cipherText) => {
  if (!isIvCipher(cipherText)) return cipherText || undefined;
  try {
    const [ivHex, dataHex] = cipherText.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const data = Buffer.from(dataHex, "hex");
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(SECRET_KEY),
      iv
    );
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
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

/* ========== Normalizers ========== */
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
  return undefined; // не распознали — считаем «текст для bio»
};

/* ========== Schema ========== */
const schema = new mongoose.Schema(
  {
    patientUUID: { type: String, default: uuidv4, unique: true },
    patientId: { type: String, required: true, unique: true },
    qrCode: { type: String }, // контроллер проставит; хук подстрахует

    linkedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      unique: true,
      sparse: true,
    },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },

    doctorId: [
      { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    ],

    // 🔐 ФИО: зашифрованные значения + хэши
    firstNameEncrypted: { type: String, index: true },
    firstNameHash: { type: String, index: true },
    lastNameEncrypted: { type: String, index: true },
    lastNameHash: { type: String, index: true },

    // 🔐 email/phone: зашифровано + хэш
    emailEncrypted: { type: String, required: true, unique: true },
    emailHash: { type: String, required: true, unique: true },
    phoneEncrypted: { type: String, default: undefined },
    phoneHash: { type: String, unique: true, sparse: true },

    // Текстовая биография (как и раньше)
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
  }
);

/* ========== Indexes ========== */
schema.index(
  { phoneEncrypted: 1 },
  {
    unique: true,
    partialFilterExpression: { phoneEncrypted: { $type: "string" } },
  }
);
schema.index({ phoneHash: 1 }, { unique: true, sparse: true });
schema.index({ doctorId: 1, createdAt: -1 });
schema.index({ firstNameHash: 1 });
schema.index({ lastNameHash: 1 });

/* ========== Setters (email/phone) ========== */
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

/* ========== Getters (email/phone) ========== */
schema.path("emailEncrypted").get(function (v) {
  return decrypt(v);
});
schema.path("phoneEncrypted").get(function (v) {
  return decrypt(v);
});

/* ========== Virtuals (имя/фамилия) ========== */
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

/* Алиасы (email/phone) */
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
  const f = this.firstName || "";
  const l = this.lastName || "";
  return (f + " " + l).trim();
});

/* ========== Hooks ========== */
// Требуем наличие ФИО (через виртуалы), генерируем UUID/QR
schema.pre("validate", async function (next) {
  try {
    if (!this.firstNameEncrypted || !this.lastNameEncrypted) {
      return next(new Error("firstName and lastName are required"));
    }
    if (!this.patientUUID) this.patientUUID = uuidv4();
    if (!this.qrCode) this.qrCode = await QRCode.toDataURL(this.patientUUID);
    next();
  } catch (e) {
    next(e);
  }
});

// Если *Encrypted заданы напрямую — добиваем хэши
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

// Поддерживаем isActive из связанного User
schema.pre("save", async function (next) {
  if (this.linkedUserId) {
    const user = await User.findById(this.linkedUserId);
    this.isActive = user?.role === "patient";
  }
  next();
});

/* Прямые апдейты: поддержка legacy gender → bio, а также нормализация */
function getSetObj(update) {
  if (!update || typeof update !== "object") return {};
  if (update.$set && typeof update.$set === "object") return update.$set;
  return update;
}

schema.pre("findOneAndUpdate", function (next) {
  const update = this.getUpdate() || {};
  const $set = getSetObj(update);

  // Имя/фамилия — принимаем как плейн или как *Encrypted
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

  if ($set.firstNameEncrypted != null) {
    const plain = isIvCipher($set.firstNameEncrypted)
      ? decrypt($set.firstNameEncrypted)
      : String($set.firstNameEncrypted);
    const safe = (plain || "").trim();
    $set.firstNameEncrypted = safe ? encrypt(safe) : undefined;
    $set.firstNameHash = safe ? sha256Lower(safe) : undefined;
  }
  if ($set.lastNameEncrypted != null) {
    const plain = isIvCipher($set.lastNameEncrypted)
      ? decrypt($set.lastNameEncrypted)
      : String($set.lastNameEncrypted);
    const safe = (plain || "").trim();
    $set.lastNameEncrypted = safe ? encrypt(safe) : undefined;
    $set.lastNameHash = safe ? sha256Lower(safe) : undefined;
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

  // 🧩 Back-compat: прислали gender как раньше?
  if ($set.gender != null) {
    const raw = String($set.gender).trim();
    const norm = normalizeGender(raw); // male/female/other/unknown | undefined
    if (norm) {
      $set.gender = norm; // пишем в новое поле gender
      // если bio не прислали — НЕ трогаем его в случае нормальной формы
    } else {
      // старый произвольный текст "gender" — кладём в bio, не ломая контракт
      if ($set.bio == null) $set.bio = raw;
      // поле gender не трогаем (останется прежним)
      delete $set.gender;
    }
  }

  if (update.$set) this.setUpdate({ ...update, $set });
  else this.setUpdate($set);
  next();
});
schema.pre("save", function (next) {
  if (process.env.NODE_ENV !== "production") {
    const stack = new Error().stack?.split("\n").slice(2, 10).join("\n");
    console.warn(
      "⚠️ TRY CREATE NewPatientPolyclinic:",
      JSON.stringify(
        {
          patientId: this.patientId,
          linkedUserId: this.linkedUserId,
          emailEncrypted: this.emailEncrypted,
          identityDocument: this.identityDocument,
          doctorId: this.doctorId,
        },
        null,
        2
      ),
      "\ncallsite:\n",
      stack
    );
  }
  next();
});
schema.pre("save", function (next) {
  if (
    process.env.BLOCK_SILENT_NPC === "1" &&
    this.$locals?.allowCreate !== true
  ) {
    return next(
      new Error(
        "Creation of NewPatientPolyclinic requires $locals.allowCreate=true"
      )
    );
  }
  next();
});
/* ====== HARD GUARD against silent creation/upsert ====== */
function _allowedCreate(doc) {
  return Boolean(doc && doc.$locals && doc.$locals.allowCreate === true);
}

// Блокируем doc.save() без флага
schema.pre("save", function (next) {
  if (!_allowedCreate(this)) {
    const stack = new Error(
      "NPC creation blocked: missing $locals.allowCreate=true"
    ).stack;
    console.error(stack);
    return next(
      new Error(
        "Creation of NewPatientPolyclinic requires $locals.allowCreate=true"
      )
    );
  }
  next();
});

// Блокируем insertMany без флага
schema.pre("insertMany", function (next, docs) {
  const bad = (docs || []).filter((d) => !_allowedCreate(d));
  if (bad.length) {
    const stack = new Error(
      "NPC insertMany blocked: docs without $locals.allowCreate=true"
    ).stack;
    console.error(stack);
    return next(
      new Error("insertMany requires $locals.allowCreate=true on each doc")
    );
  }
  next();
});

// Блокируем upsert-ы через findOneAndUpdate
schema.pre("findOneAndUpdate", function (next) {
  const opts = this.getOptions?.() || {};
  if (opts.upsert) {
    const stack = new Error(
      "NPC upsert blocked: use explicit create with $locals.allowCreate"
    ).stack;
    console.error(stack);
    return next(
      new Error(
        "Upsert to NewPatientPolyclinic is disabled. Use explicit create with $locals.allowCreate=true"
      )
    );
  }
  next();
});
// common/models/newPatientPolyclinic.js

// Подстрахуем Model.create (хоть он и вызывает save)
const _origCreate = schema.statics.create;
schema.statics.create = function (docs, options, cb) {
  const arr = Array.isArray(docs) ? docs : [docs];
  const bad = arr.filter((d) => !_allowedCreate(d));
  if (bad.length) {
    const stack = new Error(
      "NPC Model.create blocked: missing $locals.allowCreate=true"
    ).stack;
    console.error(stack);
    const err = new Error(
      "Model.create requires $locals.allowCreate=true on each doc"
    );
    if (typeof cb === "function") return cb(err);
    return Promise.reject(err);
  }
  return _origCreate.call(this, docs, options, cb);
};

/* ========== Model (re-compile safe) ========== */
const NewPatientPolyclinic =
  mongoose.models.NewPatientPolyclinic ||
  mongoose.model("NewPatientPolyclinic", schema);

// ✅ Регистрируем псевдоним для populate('Patient')
if (!mongoose.models.Patient) {
  mongoose.model("Patient", schema);
}

export default NewPatientPolyclinic;
