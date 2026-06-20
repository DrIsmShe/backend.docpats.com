// server/modules/clinic/clinic-core/clinic.model.js
//
// The Clinic root entity.
// Lives at the top of the multi-tenant hierarchy: every clinic-* document
// references a Clinic via clinicId.
//
// NOTE: This model does NOT use tenantScopedPlugin — Clinic IS the tenant.
// It uses softDelete only.

import mongoose from "mongoose";
import { softDeletePlugin } from "../../../../common/plugins/softDelete.plugin.js";
import slugify from "slugify";

const ALLOWED_TIERS = ["starter", "pro", "medical_tourism", "enterprise"];
const SUPPORTED_LANGUAGES = ["ru", "en", "tr", "az", "ar"];

// ───────────────────────────────────────────────────────────────────────────
// Clinic-as-Brand (этап A): публичный мини-сайт клиники.
// Галерея фото — отдельный сабдокумент, _id сохраняем (нужен для точечного
// удаления/переупорядочивания на этапе B при загрузке медиа в R2).
// ───────────────────────────────────────────────────────────────────────────
const galleryItemSchema = new mongoose.Schema(
  {
    // R2-ключ или абсолютный CDN-URL (https://media.docpats.com/...)
    url: { type: String, required: true, trim: true },
    caption: { type: String, trim: true, maxlength: 300, default: "" },
    order: { type: Number, default: 0 },
  },
  { _id: true },
);

const clinicSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },

    // URL-friendly identifier: "best-clinic-baku"
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 100,
      match: /^[a-z0-9-]+$/,
    },

    legalName: { type: String, trim: true, maxlength: 300 },
    taxId: { type: String, trim: true, maxlength: 50 }, // VOEN, ИНН, VAT

    contacts: {
      phone: { type: String, trim: true },
      email: { type: String, trim: true, lowercase: true },
      website: { type: String, trim: true },
    },

    address: {
      country: { type: String, trim: true },
      city: { type: String, trim: true },
      street: { type: String, trim: true },
      postalCode: { type: String, trim: true },
      coordinates: {
        lat: Number,
        lng: Number,
      },
    },

    // Operational settings
    timezone: { type: String, default: "Asia/Baku", trim: true },
    defaultCurrency: {
      type: String,
      default: "AZN",
      uppercase: true,
      length: 3,
    },
    defaultLanguage: {
      type: String,
      default: "ru",
      enum: SUPPORTED_LANGUAGES,
    },
    supportedLanguages: {
      type: [String],
      default: ["ru", "en"],
      validate: {
        validator: (arr) => arr.every((l) => SUPPORTED_LANGUAGES.includes(l)),
        message: "Invalid language code",
      },
    },

    // What the clinic does
    specializations: {
      type: [String],
      default: [],
    },

    // ─────────────────────────────────────────────────────────────────────
    // Public profile (Clinic-as-Brand, этап A). Не PHI — шифрование не нужно.
    // ─────────────────────────────────────────────────────────────────────
    // Логотип: R2-ключ или абсолютный CDN-URL. Загрузка — этап B.
    logo: { type: String, trim: true, default: null },

    // Публичное описание клиники (markdown/plain). Показывается гостям.
    description: { type: String, maxlength: 5000, default: "" },

    // Фото-галерея. Наполняется на этапе B (загрузка в R2 docpats-media).
    gallery: { type: [galleryItemSchema], default: [] },

    // Видимость публичной страницы /clinic/:slug.
    // false по умолчанию: пока владелец не заполнил профиль — страница скрыта.
    isPublished: { type: Boolean, default: false, index: true },

    // Owner — required, at least one person must own the clinic
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Subscription tier — controls feature flags
    tier: {
      type: String,
      enum: ALLOWED_TIERS,
      default: "starter",
      index: true,
    },

    // Status flags
    isActive: { type: Boolean, default: true, index: true },
    isVerified: { type: Boolean, default: false }, // license verified by Anthropic ops?
    verifiedAt: Date,

    // Free-form metadata for future extensions
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    collection: "clinics",
  },
);

// Soft-delete only — Clinic itself is the tenant root.
clinicSchema.plugin(softDeletePlugin);

// Indexes

clinicSchema.index({ ownerId: 1, isActive: 1 });
clinicSchema.index({ "address.city": 1, isActive: 1 });

// Helper: generate URL-safe slug from name
clinicSchema.statics.generateSlug = function (name) {
  return slugify(name, {
    lower: true,
    strict: true,
    locale: "en",
  });
};

// Pre-save: auto-generate slug if not set
clinicSchema.pre("validate", function (next) {
  if (this.isNew && !this.slug && this.name) {
    this.slug = this.constructor.generateSlug(this.name);
  }
  next();
});

const Clinic = mongoose.models.Clinic || mongoose.model("Clinic", clinicSchema);

export default Clinic;
