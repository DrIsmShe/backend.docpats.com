// server/modules/clinic/clinic-core/models/clinic.model.js
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

// ───────────────────────────────────────────────────────────────────────────
// ВИТРИНА 2.0 (V4.1): FAQ на уровне клиники.
// Одна на всю витрину. Блок faq читает clinic.faq (приоритет) → config.items
// (фолбэк). Пустые q/a допустимы (фильтруются на рендере) — модель пермиссивна.
// ───────────────────────────────────────────────────────────────────────────
const faqItemSchema = new mongoose.Schema(
  {
    q: { type: String, trim: true, maxlength: 300, default: "" },
    a: { type: String, trim: true, maxlength: 2000, default: "" },
  },
  { _id: false },
);

// ───────────────────────────────────────────────────────────────────────────
// ВИТРИНА 2.0 (V0): движок тем + блоковая раскладка.
//
// ПРИНЦИП: модель хранит только КЛЮЧИ (строки). Сами значения (цвета, шрифты,
// CSS-переменные) живут в словарях themePresets.js. Резолвер в сервисном слое
// маппит ключ → значение. Поэтому здесь НЕТ enum/хардкода палитр: добавление
// новой палитры/шрифта в словарь не должно требовать миграции старых клиник.
//
// Валидация ключей (palette ∈ PALETTES, type ∈ registry и т.д.) делается в
// сервисе против themePresets.js, а не в Mongoose-валидаторе — иначе расширение
// словаря ломает существующие документы.
// ───────────────────────────────────────────────────────────────────────────
const themeSchema = new mongoose.Schema(
  {
    // Имя пресета: бандл (палитра + шрифты + стили) для быстрого старта.
    preset: { type: String, trim: true, default: "classic" },
    // Ключ палитры из PALETTES (cream-teal/teal/blue/bordeaux…).
    palette: { type: String, trim: true, default: "cream-teal" },
    // Ключ пары шрифтов из FONT_PAIRS.
    fontPair: { type: String, trim: true, default: "lora-jakarta" },
    // Стиль hero-блока из HERO_STYLES (gradient/photo/minimal/split).
    heroStyle: { type: String, trim: true, default: "gradient" },
    // Стиль карточек из CARD_STYLES (elevated/flat/outline…).
    cardStyle: { type: String, trim: true, default: "elevated" },
    // Фон ВСЕЙ страницы из PAGE_BG_STYLES (none/gradient/photo). Независим
    // от hero. photo использует clinic.pageBackground.
    pageBgStyle: { type: String, trim: true, default: "none" },
    // Затемнение фото-фона: 0 = фото целиком, 92 = почти сплошной цвет.
    pageBgDim: { type: Number, default: 85, min: 0, max: 92 },
    // Ширина контента всех блоков, px [380..1600]. 1600 = 100% (резиновая).
    contentWidth: { type: Number, default: 1040, min: 380, max: 1600 },
    // Высота hero (обложки): 0 = авто (по контенту), иначе [100..850]px.
    heroHeight: { type: Number, default: 0, min: 0, max: 850 },
  },
  { _id: false },
);

// Один блок раскладки. _id ВКЛЮЧЁН — нужен для точечного drag-drop
// переупорядочивания в редакторе (V3).
const layoutBlockSchema = new mongoose.Schema(
  {
    // Ключ компонента из реестра (V1): topbar/nav/hero/stats/whyUs/doctors/
    // bento/reviews/publications/gallery/faq/contacts/cta/footer.
    type: { type: String, required: true, trim: true },
    // Показывать ли блок на витрине.
    visible: { type: Boolean, default: true },
    // Порядок рендера (по возрастанию).
    order: { type: Number, default: 0 },
    // Произвольная per-block конфигурация (заголовки, флаги, ссылки…).
    // Контракт config зависит от type и читается компонентом-блоком.
    config: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  },
  { _id: true },
);

// Дефолтная раскладка: рабочая витрина «из коробки» для новой клиники.
// Возвращаем фабрикой — свежие объекты на каждый документ (без shared-ref).
//
// ЕДИНЫЙ ИСТОЧНИК: экспортируется и используется как fallback в публичном
// маппере для старых клиник, у которых layout отсутствует в БД (lean НЕ
// применяет дефолты схемы). Не дублировать этот список где-либо ещё.
export function defaultLayoutBlocks() {
  return [
    { type: "topbar", visible: true, order: 0, config: {} },
    { type: "nav", visible: true, order: 1, config: {} },
    { type: "hero", visible: true, order: 2, config: {} },
    { type: "stats", visible: true, order: 3, config: {} },
    { type: "whyUs", visible: true, order: 4, config: {} },
    { type: "doctors", visible: true, order: 5, config: {} },
    { type: "bento", visible: true, order: 6, config: {} },
    { type: "reviews", visible: true, order: 7, config: {} },
    { type: "publications", visible: true, order: 8, config: {} },
    { type: "gallery", visible: true, order: 9, config: {} },
    // faq скрыт по умолчанию — включается владельцем после заполнения (V4.1).
    { type: "faq", visible: false, order: 10, config: {} },
    { type: "contacts", visible: true, order: 11, config: {} },
    { type: "cta", visible: true, order: 12, config: {} },
    { type: "footer", visible: true, order: 13, config: {} },
  ];
}

const layoutSchema = new mongoose.Schema(
  {
    blocks: { type: [layoutBlockSchema], default: defaultLayoutBlocks },
  },
  { _id: false },
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

    // ─────────────────────────────────────────────────────────────────────
    // ВИТРИНА 2.0 (V4.1): brand-поля уровня клиники. Не PHI.
    // Приоритет в блоках: поле клиники > config блока > пусто (обратная
    // совместимость с тем, что владелец уже ввёл в редакторе V3.3).
    // ─────────────────────────────────────────────────────────────────────
    // Обложка hero (photo/split-стили). R2-ключ/URL. Загрузка — отдельный шаг.
    coverImage: { type: String, trim: true, default: null },
    // Фоновое фото ВСЕЙ страницы (theme.pageBgStyle === "photo"). Отдельно
    // от coverImage. R2-ключ/URL. Загрузка — отдельный шаг.
    pageBackground: { type: String, trim: true, default: null },
    // Слоган — подзаголовок героя. Приоритетнее hero config.slogan.
    slogan: { type: String, trim: true, maxlength: 200, default: "" },
    // Телефон записи (колл-центр/регистратура). Для cta и topbar.
    callCenterPhone: { type: String, trim: true, maxlength: 40, default: "" },
    // Часы работы колл-центра. Для topbar (приоритетнее config.hours).
    callCenterHours: { type: String, trim: true, maxlength: 120, default: "" },
    // FAQ клиники. Блок faq читает это (приоритет) → config.items (фолбэк).
    faq: { type: [faqItemSchema], default: [] },

    // Видимость публичной страницы /clinic/:slug.
    // false по умолчанию: пока владелец не заполнил профиль — страница скрыта.
    isPublished: { type: Boolean, default: false, index: true },

    // ─────────────────────────────────────────────────────────────────────
    // ВИТРИНА 2.0 (V0). Не PHI — шифрование не нужно.
    // theme  — токены оформления (ключи в словари themePresets.js).
    // layout — какие блоки рендерить, в каком порядке, с какой конфигурацией.
    // Дефолты дают рабочую витрину сразу, без заполнения владельцем.
    // ─────────────────────────────────────────────────────────────────────
    theme: { type: themeSchema, default: () => ({}) },
    layout: { type: layoutSchema, default: () => ({}) },

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

// Зарезервированные корневые пути — клиника с таким slug затенила бы реальный
// маршрут (клиники теперь доступны по корневому /:slug). Такому slug добавляем
// суффикс "-clinic".
const RESERVED_SLUGS = new Set([
  "login", "registration", "register", "pricing", "demo", "patient", "doctor",
  "dp", "clinic", "clinics", "admin", "public", "api", "top-doctors",
  "subscription", "payment", "complete-registration", "resetpassword",
  "resetpasswordchange", "otpresetpasswordchange", "confirmationregister",
  "about", "articles", "article", "news", "consultation", "uploads", "static",
  "assets", "images", "sitemap", "robots", "manifest", "sw", "favicon",
]);

// Helper: generate URL-safe slug from name
clinicSchema.statics.generateSlug = function (name) {
  let base = slugify(name || "", { lower: true, strict: true, locale: "en" });
  if (!base) base = "clinic";
  if (RESERVED_SLUGS.has(base)) base = `${base}-clinic`;
  return base;
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
