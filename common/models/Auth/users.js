// server/common/models/Auth/users.js
// ─────────────────────────────────────────────────────────────────────
//   ЗАМЕНИТЬ ЦЕЛИКОМ — модель User со всеми полями подписки v2
//
//   Изменения относительно предыдущей версии:
//   1. Удалён мёртвый код (объект subscriptionFields)
//   2. Расширен enum subscriptionPlan новыми ключами + сохранены legacy
//   3. Переименовано subscriptionExpiresAt → subscriptionEndsAt
//   4. Добавлены поля: subscriptionPeriod, trialEndsAt, trialReminders,
//      paymentCustomerId/SubscriptionId/LastChargedAt
//   5. Pre-save хук теперь синхронизирует features.maxPatients и при
//      изменении subscriptionPlan, и при изменении subscription.tier
//   6. Объект subscription (с tier/billing/status) сохранён без изменений
//      для обратной совместимости
//   7. Виртуалы, методы, encryption, RBAC, sessions — все сохранены
//   8. NEW (22 May 2026): reissueHistory[] — лог перевыпусков
//      provisional-карточки разными клиниками. Каждая запись = одна
//      операция перевыпуска (см. provisional.service.reissueProvisionalCredentials).
//      provisionalCreatedBy при этом НЕ меняется — остаётся изначальная
//      клиника. Это позволяет audit-системе ответить на вопросы:
//        - "кто впервые создал этот provisional?" → provisionalCreatedBy
//        - "кто потом перевыпускал?" → reissueHistory
//        - "почему пациент пожаловался что карта Клиники Y не работает?"
//          → найти reissueHistory[i] где другая клиника перевыпустила.
// ─────────────────────────────────────────────────────────────────────

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

/* ──────────── ReissueHistory подсхема (22 May 2026) ─────────────────
   Каждая запись = один акт перевыпуска provisional-карточки.
   _id: false — это плоская запись внутри User, не отдельный документ.

   Поля:
   - clinicId        — клиника которая перевыпустила
   - reissuedAt      — когда
   - reissuedBy      — actor (userId или employeeId — см. reissuedByType)
   - reissuedByType  — "user" | "employee" (как createdByType в ClinicPatient)
   - previousExpiresAt — старый provisionalExpiresAt ДО перевыпуска
                         (нужно для audit: "у пациента было ещё X дней,
                         клиника Y продлила на ещё 3 года")

   provisionalCreatedBy/At/ExpiresAt на родительском User обновляются:
   - createdBy: не меняется (изначальная клиника навсегда)
   - createdAt: не меняется (когда изначально создан)
   - expiresAt: ПЕРЕЗАПИСЫВАЕТСЯ на now + 3 года при каждом перевыпуске
================================================================== */
const ReissueHistorySchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
    },
    reissuedAt: { type: Date, default: Date.now, required: true },
    reissuedBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    reissuedByType: {
      type: String,
      enum: ["user", "employee"],
      required: true,
    },
    previousExpiresAt: { type: Date, default: null },
  },
  { _id: false },
);

/* ======================= Маппинг плана → maxPatients =====================
   Используется в pre-save хуке для синхронизации features.maxPatients
   при изменении subscriptionPlan (плоское поле) или subscription.tier
   (объектное поле).

   Числа должны совпадать с patientsInOffice в aiPlanLimits.js.
========================================================================= */
const PLAN_TO_MAX_PATIENTS = {
  // Новые ключи (тарифная сетка v3) — совпадают с patientsInOffice в aiPlanLimits.js
  doctor_basic: 50,
  doctor_super: 500,
  doctor_pro: -1, // -1 = безлимит (middleware requireDoctorPatientLimit это понимает)
  doctor_trial: 500, // как Growth во время trial

  patient_free: 0,
  patient_std: 0,
  patient_pro: 0,

  clinic_start: 1000,
  clinic: 1000,
  clinic_pro: 1000,

  // Legacy ключи
  free: 5, // у врачей было — 5 пациентов
  doctor_free: 5,
  doctor_plus: 50,
  standard: 0,
  premium: 0,
};

/* ======================= Основная схема User ======================= */
const userSchema = new mongoose.Schema(
  {
    offenseCount: { type: Number, default: 0 },
    lastOffenseAt: { type: Date },
    blockedUntil: { type: Date, default: null },
    permanentlyBanned: { type: Boolean, default: false },

    /* ───── Подписка v2 — плоский план (основной источник правды) ───── */
    subscriptionPlan: {
      type: String,
      enum: [
        // Новые ключи v2
        "patient_free",
        "patient_std",
        "patient_pro",
        "doctor_basic",
        "doctor_super",
        "doctor_pro",
        "clinic_start",
        "clinic",
        "clinic_pro",
        // Legacy — оставить для обратной совместимости с существующими юзерами в БД
        "free",
        "standard",
        "premium",
        "doctor_free",
        null,
      ],
      default: null, // null = автоопределение через resolveEffectivePlan по role и trialEndsAt
    },

    // Период подписки — для скидки -20% на годовую
    subscriptionPeriod: {
      type: String,
      enum: ["monthly", "yearly", null],
      default: null,
    },

    // Когда заканчивается оплаченный период подписки
    // (раньше это поле называлось subscriptionExpiresAt)
    subscriptionEndsAt: {
      type: Date,
      default: null,
    },

    // Когда заканчивается TRIAL для врачей.
    // У пациентов = null. У врачей при регистрации = Date.now() + 180 days.
    // После окончания resolveEffectivePlan вернёт "doctor_basic".
    trialEndsAt: {
      type: Date,
      default: null,
    },

    // Флаги отправленных email-напоминаний об окончании trial
    trialReminders: {
      sent30d: { type: Boolean, default: false },
      sent7d: { type: Boolean, default: false },
      sent1d: { type: Boolean, default: false },
    },

    // Stripe / платёжный шлюз
    paymentCustomerId: { type: String, default: null },
    paymentSubscriptionId: { type: String, default: null },
    paymentLastChargedAt: { type: Date, default: null },

    /* ───── Идентификация и шифрование ───── */
    emailHash: { type: String, required: true, unique: true, index: true },
    emailEncrypted: { type: String, required: true },
    firstNameHash: { type: String, required: true, index: true },
    firstNameEncrypted: { type: String, required: true },
    lastNameHash: { type: String, required: true, index: true },
    lastNameEncrypted: { type: String, required: true },

    photo: { type: String, trim: true },
    diskSpace: { type: Number, default: 1024 ** 3 * 10 },
    usedSpace: { type: Number, default: 0 },
    avatar: { type: String, default: "/uploads/avatars/boy01.png" },

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

    /* ───── Provisional registration v2 (19 мая 2026) ─────
       Клиника может зарегистрировать пациента БЕЗ его участия,
       создав временный User с tmp email и паролем. У пациента
       3 года, чтобы активировать аккаунт (сменить email + пароль
       через POST /auth/complete-provisional-registration).
       Если просрочил — cron анонимизирует данные.
       Если пациент пришёл в другую клинику до активации —
       клиника может перевыпустить карточку (см. reissueHistory).
    */
    isProvisional: { type: Boolean, default: false, index: true },
    provisionalCreatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      default: null,
    },
    provisionalCreatedAt: { type: Date, default: null },
    provisionalExpiresAt: { type: Date, default: null }, // создан + 3 года
    mustCompleteRegistration: { type: Boolean, default: false },

    // История перевыпусков карточки (22 May 2026).
    // Каждая запись добавляется при вызове reissueProvisionalCredentials.
    // Изначально пустой массив — у "свежесозданного" provisional User'а
    // нет ни одного перевыпуска.
    reissueHistory: { type: [ReissueHistorySchema], default: [] },

    // Анонимизация — для просроченных или стёртых клиникой записей.
    // _id сохраняется для FK integrity (ClinicPatient.linkedUserId).
    isAnonymized: { type: Boolean, default: false, index: true },
    anonymizedAt: { type: Date, default: null },
    anonymizedReason: {
      type: String,
      enum: ["expired", "wiped_by_clinic", null],
      default: null,
    },
    /* ───── Provisional activation OTP (21 мая 2026) ─────
       Two-step activation: patient enters new email+password →
       backend generates 6-digit OTP, stores it here as plain text,
       sends to the new email. Patient enters OTP within 10 min →
       changes are applied, all fields below cleared to null.

       Plain text matches the pattern of User.otp / User.childOtp /
       User.parentOtp for ordinary registration — visible in Mongo
       Compass for debugging when email delivery fails.

       pendingNewEmail is encrypted (same AES-256-CBC as emailEncrypted)
       because it's PII even before activation. pendingNewPasswordHash
       is already an argon2 hash — no further encryption needed.
    */
    activationOtp: { type: String, default: null },
    activationOtpExpiresAt: { type: Date, default: null },
    activationOtpAttempts: { type: Number, default: 0 },
    activationOtpLastSentAt: { type: Date, default: null },
    pendingNewEmailEncrypted: { type: String, default: null },
    pendingNewPasswordHash: { type: String, default: null },
    otpPassword: { type: String },
    // M-1: счётчик неверных попыток ввода OTP (сброс/смена пароля).
    // После лимита код гасится, чтобы его нельзя было добить перебором.
    otpAttempts: { type: Number, default: 0 },
    lastLoginAt: { type: Date, default: null },

    // ─── Реферальная программа (сарафанное радио) ───
    // referralCode — мой личный код-приглашение; referredBy — кто пригласил
    // меня; referralCount — сколько людей зарегистрировалось по моему коду.
    // без default: поле отсутствует до присвоения кода → sparse-unique корректен
    // (иначе множество null нарушили бы уникальность).
    referralCode: { type: String, unique: true, sparse: true },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    referralCount: { type: Number, default: 0 },
    referralBonusDays: { type: Number, default: 0 }, // сколько бонус-дней trial начислено
    // Бонусные AI-консультации за рефералов (актуально для пациентов, у которых нет trial).
    // Прибавляются к лимиту в consultation.service.js.
    bonusConsultations: { type: Number, default: 0 },

    isVerified: { type: Boolean, default: false },
    isBlocked: { type: Boolean, default: false },
    blockUntil: { type: Date, default: null },
    otpExpiresAt: { type: Date, default: null },

    agreement: { type: Boolean, required: true },
    registeredAt: { type: Date, default: null },
    isChild: { type: Boolean, default: false },
    childStatus: { type: String, default: "pending" },
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

    /* ───── Объектная подписка (legacy) — оставлена для совместимости ───── */
    // НЕ ИСПОЛЬЗОВАТЬ для новой логики. Все новые проверки идут через
    // плоское поле subscriptionPlan + resolveEffectivePlan.
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
        provider: { type: String },
        customerId: String,
        subscriptionId: String,
      },
    },

    features: {
      maxPatients: { type: Number, default: 5 },
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

    verification: {
      status: {
        type: String,
        enum: ["none", "pending", "approved", "rejected"],
        default: "none",
      },
      verifiedAt: { type: Date, default: null },
      reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      note: { type: String, default: null },
    },

    verificationDocuments: [
      {
        type: {
          type: String,
          enum: ["license", "diploma", "selfie"],
          required: true,
        },
        fileUrl: { type: String, required: true },
        uploadedAt: { type: Date, default: Date.now },
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
      enum: ["en", "ru", "az", "tr", "ar"],
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
userSchema.index({ trialEndsAt: 1 }); // для cron-задачи trial-напоминаний
userSchema.index({ subscriptionEndsAt: 1 });
userSchema.index({ dateOfBirth: 1 }); // поиск user по ДР при линковке пациента к карте клиники

// Поиск provisional User по ДР при следующем визите в клинику —
// hits dateOfBirth + isProvisional + isAnonymized для быстрого "active provisional only"
userSchema.index({ dateOfBirth: 1, isProvisional: 1, isAnonymized: 1 });

// Cron cleanup — найти все просроченные provisional, ещё не анонимизированные
userSchema.index({
  provisionalExpiresAt: 1,
  isProvisional: 1,
  isAnonymized: 1,
});

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
  // 🔐 Шифрование полей PII
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

  // 🧠 Подписка → лимиты maxPatients
  // Срабатывает при изменении НОВОГО плоского поля subscriptionPlan
  // ИЛИ старого объектного subscription.tier — для обратной совместимости
  // с кодом который мог использовать старый формат.
  if (
    this.isModified("subscriptionPlan") ||
    this.isModified("subscription.tier")
  ) {
    const planKey = this.subscriptionPlan || this.subscription?.tier;
    const mapped = PLAN_TO_MAX_PATIENTS[planKey];
    if (mapped !== undefined) {
      // Инициализируем features если его ещё нет
      if (!this.features) this.features = {};
      this.features.maxPatients = mapped;
    }
  }

  // 🔒 Проверка permissions
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

// Удобный виртуал — врач сейчас в trial-периоде?
userSchema.virtual("isInTrial").get(function () {
  if (this.role !== "doctor") return false;
  if (!this.trialEndsAt) return false;
  return new Date() < new Date(this.trialEndsAt);
});

// Сколько дней trial осталось (или null если не в trial)
userSchema.virtual("trialDaysLeft").get(function () {
  if (!this.isInTrial) return null;
  const ms = new Date(this.trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
});
// Provisional — истёк ли срок активации?
userSchema.virtual("isProvisionalExpired").get(function () {
  if (!this.isProvisional) return false;
  if (!this.provisionalExpiresAt) return false;
  return new Date() >= new Date(this.provisionalExpiresAt);
});

// Сколько дней осталось до автоматической анонимизации provisional User.
// null если не provisional. Может быть отрицательным = просрочено.
userSchema.virtual("provisionalDaysLeft").get(function () {
  if (!this.isProvisional) return null;
  if (!this.provisionalExpiresAt) return null;
  const ms = new Date(this.provisionalExpiresAt).getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
});

// Сколько раз перевыпускалась provisional-карточка (включая 0 = ни разу).
// Удобно для UI: "Карта перевыпускалась 2 раза в Клинике X и Клинике Y"
userSchema.virtual("reissueCount").get(function () {
  return Array.isArray(this.reissueHistory) ? this.reissueHistory.length : 0;
});

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

    // Секреты, которые НИКОГДА не должны уходить в ответ (утечка = офлайн-брутфорс
    // паролей, кража 2FA и активных сессий). Раньше toJSON их не вычищал, и
    // admin-контроллеры возвращали хэш пароля/2FA/сессии.
    delete ret.password;
    delete ret.passwordHistory;
    delete ret.twoFactorAuth;
    delete ret.sessions;
    delete ret.pendingNewPasswordHash;
    delete ret.otpPassword;
    delete ret.activationOtp;

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
export { decrypt };
export default User;
