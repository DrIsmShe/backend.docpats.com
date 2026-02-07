// Импорт ядра и утилит ----------------------------------------------------------
import mongoose from "mongoose";
import crypto from "crypto";
import "dotenv/config";
import { sanitizeUsername } from "../../utils/sanitizeUsername.js";

/* ======================= Крипто-константы и утилиты ======================= */
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

const decrypt = (value) => {
  if (value == null) return value;
  const s = String(value);
  if (!isEncrypted(s)) return s;
  try {
    const [ivHex, dataHex] = s.split(":");
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
  } catch (err) {
    console.error("❌ Ошибка расшифровки:", err.message);
    return null;
  }
};

const sha256 = (v) =>
  v == null ? v : crypto.createHash("sha256").update(String(v)).digest("hex");

const normalizeEmailForHash = (v) =>
  v == null ? v : String(v).trim().toLowerCase();

const normalizeNameForHash = (v) => (v == null ? v : String(v).trim());

/* ======================= RBAC/ABAC: роли и права ======================= */
export const KNOWN_PERMISSIONS = [
  "user.read",
  "user.create",
  "user.update",
  "user.delete",
  "file.read",
  "file.upload",
  "file.delete",
  "admin.dashboard.read",
  "admin.user.manage",
  "chat.read",
  "chat.write",
  "message.moderate",
];

export const ROLE_PRESETS = {
  admin: [
    "user.read",
    "user.create",
    "user.update",
    "user.delete",
    "file.read",
    "file.upload",
    "file.delete",
    "admin.dashboard.read",
    "admin.user.manage",
    "chat.read",
    "chat.write",
    "message.moderate",
  ],

  doctor: ["user.read", "file.read", "file.upload", "chat.read", "chat.write"],

  patient: ["user.read", "file.read", "file.upload", "chat.read", "chat.write"],

  /* ===== КЛИНИКИ ===== */

  clinic_admin: [
    "user.read",
    "file.read",
    "file.upload",
    "admin.dashboard.read",
    "admin.user.manage",
  ],

  clinic_staff: ["user.read", "file.read"],
};

/* ======================= Подсхемы ======================= */
const AccessControlSchema = new mongoose.Schema(
  {
    permissions: {
      type: [String],
      default: [],
      validate: {
        validator: (arr) => arr.every((p) => KNOWN_PERMISSIONS.includes(p)),
        message: "Unknown permission in access.permissions",
      },
    },
    scopes: { type: [String], default: [] },
  },
  { _id: false },
);

const OrgMembershipSchema = new mongoose.Schema(
  {
    orgId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ["owner", "admin", "member", "viewer"],
      default: "member",
    },
    permissions: { type: [String], default: [] },
  },
  { _id: false },
);

const ApiKeySchema = new mongoose.Schema(
  {
    label: { type: String, trim: true },
    hashedKey: { type: String, required: true, index: true },
    scopes: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date },
    revokedAt: { type: Date, default: null },
  },
  { _id: false },
);

const SessionSchema = new mongoose.Schema(
  {
    device: { type: String },
    ip: { type: String },
    userAgent: { type: String },
    createdAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    revokedAt: { type: Date, default: null },
  },
  { _id: true },
);

/* ======================= Основная схема User ======================= */
const userSchema = new mongoose.Schema(
  {
    offenseCount: { type: Number, default: 0 },
    lastOffenseAt: { type: Date },
    blockedUntil: { type: Date, default: null },
    permanentlyBanned: { type: Boolean, default: false },

    emailHash: { type: String, required: true, unique: true, index: true },
    emailEncrypted: { type: String, required: true },
    firstNameHash: { type: String, required: true, index: true },
    firstNameEncrypted: { type: String, required: true },
    lastNameHash: { type: String, required: true, index: true },
    lastNameEncrypted: { type: String, required: true },

    photo: { type: String, trim: true },
    diskSpace: { type: Number, default: 1024 ** 3 * 10 },
    usedSpace: { type: Number, default: 0 },
    avatar: { type: String, default: "/uploads/avatars/gorilla.png" },

    specialization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Specialization",
    },
    myDoctors: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    files: [{ type: mongoose.Schema.Types.ObjectId, ref: "File" }],

    password: { type: String, required: true },
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
      match: /^[a-zA-Z0-9._-]{3,30}$/,
      index: true,
      set: (v) => sanitizeUsername(v),
    },

    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    dateOfBirth: { type: Date, required: true },
    bio: { type: String, required: true, maxlength: 500 },

    role: {
      type: String,
      enum: ["doctor", "patient", "admin", "clinic_admin", "clinic_staff"],
      required: true,
    },
    isDoctor: { type: Boolean, default: true },
    isPatient: { type: Boolean, default: false },

    mustChangePassword: { type: Boolean, default: false },
    otpPassword: { type: String },
    lastLoginAt: { type: Date, default: null },

    isVerified: { type: Boolean, default: false },
    isBlocked: { type: Boolean, default: false },
    blockUntil: { type: Date, default: null },
    otpExpiresAt: { type: Date, default: null },

    agreement: { type: Boolean, required: true },
    registeredAt: { type: Date, default: null },
    isChild: { type: Boolean, default: false },
    childStatus: { type: String, default: "pending" }, // pending / waitingParent / active
    parentEmail: { type: String, default: null },
    childOtp: { type: String, default: null },
    childOtpExpires: { type: Date, default: null },
    parentOtp: { type: String, default: null },
    parentOtpExpires: { type: Date, default: null },

    status: {
      type: String,
      enum: ["online", "offline", "away", "invisible"],
      default: "offline",
    },

    subscription: {
      tier: {
        type: String,
        enum: [
          "doctor_free",
          "doctor_plus",
          "doctor_pro",
          "patient_free",
          "patient_plus",
          "patient_family",
        ],
        default: "patient_free",
      },

      status: {
        type: String,
        enum: ["active", "trial", "expired", "canceled"],
        default: "active",
      },

      startedAt: Date,
      expiresAt: Date,

      billing: {
        provider: { type: String }, // stripe | manual | clinic
        customerId: String,
        subscriptionId: String,
      },
    },
    features: {
      maxPatients: { type: Number, default: 0 },
      aiAccess: { type: Boolean, default: false },
      prioritySupport: { type: Boolean, default: false },
      familyMembers: { type: Number, default: 0 },
    },

    lastActive: { type: Date, default: Date.now },

    contacts: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    conversations: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Conversation" },
    ],
    messages: [{ type: mongoose.Schema.Types.ObjectId, ref: "Message" }],
    notificationsEnabled: { type: Boolean, default: true },
    typingInChat: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      default: null,
    },
    archivedChats: [{ type: mongoose.Schema.Types.ObjectId, ref: "Chat" }],
    pinnedChats: [{ type: mongoose.Schema.Types.ObjectId, ref: "Chat" }],
    blockedContacts: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    privacySettings: {
      lastSeenVisibleTo: {
        type: String,
        enum: ["everyone", "contacts", "no one"],
        default: "contacts",
      },
      profilePhotoVisibleTo: {
        type: String,
        enum: ["everyone", "contacts", "no one"],
        default: "everyone",
      },
      aboutVisibleTo: {
        type: String,
        enum: ["everyone", "contacts", "no one"],
        default: "everyone",
      },
      readReceipts: { type: Boolean, default: true },
    },

    statuses: [
      {
        content: String,
        type: {
          type: String,
          enum: ["text", "image", "video"],
          required: true,
        },
        createdAt: { type: Date, default: Date.now },
        expiresAt: {
          type: Date,
          default: () => Date.now() + 24 * 60 * 60 * 1000,
        },
        views: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      },
    ],

    callHistory: [
      {
        callType: { type: String, enum: ["audio", "video"], required: true },
        participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
        duration: { type: Number },
        timestamp: { type: Date, default: Date.now },
      },
    ],

    mediaShared: [{ type: mongoose.Schema.Types.ObjectId, ref: "File" }],
    achievements: [
      {
        name: String,
        description: String,
        unlockedAt: { type: Date, default: Date.now },
      },
    ],
    rewards: {
      points: { type: Number, default: 0 },
      badges: [
        {
          name: String,
          icon: String,
          unlockedAt: { type: Date, default: Date.now },
        },
      ],
    },

    aiSuggestions: [
      {
        chatId: { type: mongoose.Schema.Types.ObjectId, ref: "Chat" },
        suggestion: String,
        createdAt: { type: Date, default: Date.now },
      },
    ],

    organization: {
      name: String,
      position: String,
      verified: { type: Boolean, default: false },
    },

    favoriteMessages: [
      {
        messageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
        savedAt: { type: Date, default: Date.now },
      },
    ],

    scheduledMeetings: [
      {
        title: String,
        participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
        startTime: Date,
        endTime: Date,
        createdAt: { type: Date, default: Date.now },
      },
    ],

    themeSettings: {
      theme: {
        type: String,
        enum: ["light", "dark", "custom"],
        default: "light",
      },
      wallpaper: String,
    },

    activityLog: [
      {
        action: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
        details: String,
      },
    ],

    sharedContacts: [
      {
        sharedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        sharedTo: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        contact: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        sharedAt: { type: Date, default: Date.now },
      },
    ],

    articles: [
      {
        title: String,
        content: String,
        createdAt: { type: Date, default: Date.now },
      },
    ],
    books: [{ title: String, author: String, publishedYear: Number }],

    preferredLanguage: {
      type: String,
      enum: ["en", "ru", "az", "tr"],
      default: "en",
    },

    library: [
      {
        title: String,
        type: String,
        referenceId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "LibraryItem",
        },
      },
    ],

    friends: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        addedAt: { type: Date, default: Date.now },
      },
    ],
    comments: [{ type: mongoose.Schema.Types.ObjectId, ref: "Comment" }],
    messengerId: { type: String, trim: true },

    conferences: [
      {
        title: String,
        date: Date,
        location: String,
        role: { type: String, enum: ["doctor", "patient"] },
      },
    ],
    lessons: [
      {
        title: String,
        content: String,
        createdAt: { type: Date, default: Date.now },
      },
    ],

    maritalStatus: { type: String, trim: true },
    children: { type: String, trim: true },
    socialLinks: {
      twitter: String,
      facebook: String,
      instagram: String,
      linkedin: String,
    },
    about: { type: String, maxlength: 1200 },
    company: { type: String, trim: true },
    job: { type: String, trim: true },
    country: { type: String, trim: true },
    address: { type: String, trim: true },

    consultations: [
      {
        doctorId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "DoctorProfile",
        },
        date: Date,
        notes: String,
      },
    ],
    videoConferences: [{ title: String, date: Date, link: String }],

    twoFactorAuth: {
      enabled: { type: Boolean, default: false },
      secret: { type: String },
    },

    access: { type: AccessControlSchema, default: () => ({}) },
    orgMemberships: { type: [OrgMembershipSchema], default: [] },
    apiKeys: { type: [ApiKeySchema], default: [] },
    sessions: { type: [SessionSchema], default: [] },

    failedLoginAttempts: { type: Number, default: 0 },
    lockoutUntil: { type: Date, default: null },
    lastPasswordChangeAt: { type: Date, default: null },
    passwordHistory: { type: [String], default: [] },

    canBeImpersonated: { type: Boolean, default: true },
    impersonationLog: [
      {
        byUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        at: { type: Date, default: Date.now },
        reason: { type: String, trim: true },
      },
    ],

    consents: [
      {
        policy: { type: String, required: true },
        acceptedAt: { type: Date, default: Date.now },
        ip: { type: String },
        userAgent: { type: String },
      },
    ],

    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    featureFlags: { type: Map, of: Boolean, default: {} },
    quotas: {
      filesMax: { type: Number, default: 10_000 },
      messagesPerDay: { type: Number, default: 10_000 },
    },
  },
  { timestamps: true },
);

/* ======================= Индексы ======================= */
userSchema.index({ role: 1 });
userSchema.index({ "access.permissions": 1 });

/* ======================= Хелпер для update-хуков ======================= */
function getSetObjectFromUpdate(update) {
  if (!update || typeof update !== "object") return {};
  if (update.$set && typeof update.$set === "object") return update.$set;
  return update;
}

/* ======================= Хуки UPDATE ======================= */
userSchema.pre("findOneAndUpdate", function (next) {
  const update = this.getUpdate() || {};
  const $set = getSetObjectFromUpdate(update);

  if ($set.emailEncrypted) $set.emailEncrypted = encrypt($set.emailEncrypted);
  if ($set.firstNameEncrypted)
    $set.firstNameEncrypted = encrypt($set.firstNameEncrypted);
  if ($set.lastNameEncrypted)
    $set.lastNameEncrypted = encrypt($set.lastNameEncrypted);

  if ($set.emailEncrypted) {
    const emailPlain = decrypt($set.emailEncrypted);
    if (emailPlain) $set.emailHash = sha256(normalizeEmailForHash(emailPlain));
  }
  if ($set.firstNameEncrypted) {
    const firstPlain = decrypt($set.firstNameEncrypted);
    if (firstPlain)
      $set.firstNameHash = sha256(normalizeNameForHash(firstPlain));
  }
  if ($set.lastNameEncrypted) {
    const lastPlain = decrypt($set.lastNameEncrypted);
    if (lastPlain) $set.lastNameHash = sha256(normalizeNameForHash(lastPlain));
  }

  if (update.$set) update.$set = $set;
  else this.setUpdate($set);
  next();
});

/* ======================= Хук SAVE ======================= */
userSchema.pre("save", function (next) {
  if (this.isModified("emailEncrypted"))
    this.emailEncrypted = encrypt(this.emailEncrypted);
  if (this.isModified("firstNameEncrypted"))
    this.firstNameEncrypted = encrypt(this.firstNameEncrypted);
  if (this.isModified("lastNameEncrypted"))
    this.lastNameEncrypted = encrypt(this.lastNameEncrypted);

  if (this.isModified("emailEncrypted")) {
    const emailPlain = decrypt(this.emailEncrypted);
    if (emailPlain) this.emailHash = sha256(normalizeEmailForHash(emailPlain));
  }
  if (this.isModified("firstNameEncrypted")) {
    const firstPlain = decrypt(this.firstNameEncrypted);
    if (firstPlain)
      this.firstNameHash = sha256(normalizeNameForHash(firstPlain));
  }
  if (this.isModified("lastNameEncrypted")) {
    const lastPlain = decrypt(this.lastNameEncrypted);
    if (lastPlain) this.lastNameHash = sha256(normalizeNameForHash(lastPlain));
  }

  if (this.isModified("access") && this.access?.permissions) {
    const ok = this.access.permissions.every((p) =>
      KNOWN_PERMISSIONS.includes(p),
    );
    if (!ok) return next(new Error("Unknown permission in access.permissions"));
  }

  next();
});

/* ======================= Методы и виртуалы ======================= */
userSchema.methods.decryptFields = function () {
  return {
    email: decrypt(this.emailEncrypted),
    firstName: decrypt(this.firstNameEncrypted),
    lastName: decrypt(this.lastNameEncrypted),
  };
};

userSchema.virtual("firstName").get(function () {
  return this.firstNameEncrypted ? decrypt(this.firstNameEncrypted) : null;
});
userSchema.virtual("lastName").get(function () {
  return this.lastNameEncrypted ? decrypt(this.lastNameEncrypted) : null;
});

userSchema.virtual("effectivePermissions").get(function () {
  const roleBase = ROLE_PRESETS[this.role] || [];
  const extra = Array.isArray(this.access?.permissions)
    ? this.access.permissions
    : [];
  return Array.from(new Set([...roleBase, ...extra]));
});

userSchema.methods.can = function (permission) {
  return this.effectivePermissions.includes(permission);
};

/* ======================= Сериализация ======================= */
userSchema.set("toJSON", {
  virtuals: true,
  transform: (_, ret) => {
    delete ret.firstNameEncrypted;
    delete ret.lastNameEncrypted;
    delete ret.emailEncrypted;
    delete ret.firstNameHash;
    delete ret.lastNameHash;
    delete ret.emailHash;

    if (ret.apiKeys) {
      ret.apiKeys = ret.apiKeys.map((k) => ({
        label: k.label,
        scopes: k.scopes,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
        revokedAt: k.revokedAt,
      }));
    }
    return ret;
  },
});
userSchema.set("toObject", { virtuals: true });

/* ======================= Экспорт ======================= */
const User = mongoose.model("User", userSchema);
export { decrypt }; // именованный экспорт функции (presets уже экспортированы выше)
export default User; // дефолтная модель
