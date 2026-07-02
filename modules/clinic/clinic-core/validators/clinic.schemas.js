// modules/clinic/clinic-core/validators/clinic.schemas.js
//
// Zod schemas for request validation.

import { z } from "zod";
import {
  PALETTES,
  FONT_PAIRS,
  HERO_STYLES,
  CARD_STYLES,
  PRESETS,
  PAGE_BG_STYLES,
} from "../themePresets.js";

const SUPPORTED_LANGUAGES = ["ru", "en", "tr", "az", "ar"];
const SUPPORTED_CURRENCIES = [
  "AZN",
  "USD",
  "EUR",
  "TRY",
  "RUB",
  "GBP",
  "AED",
  "SAR",
];
const TIERS = ["starter", "pro", "medical_tourism", "enterprise"];

// ВИТРИНА 2.0 — допустимые ключи темы берём из словарей themePresets.js
// (единый источник). Так enum не разъезжается со словарями при их расширении.
const PALETTE_KEYS = Object.keys(PALETTES);
const FONT_PAIR_KEYS = Object.keys(FONT_PAIRS);
const HERO_STYLE_KEYS = Object.keys(HERO_STYLES);
const CARD_STYLE_KEYS = Object.keys(CARD_STYLES);
const PRESET_KEYS = Object.keys(PRESETS);
const PAGE_BG_STYLE_KEYS = Object.keys(PAGE_BG_STYLES);

// ───────────────────────────────────────────────────────────────────────────
// Clinic-as-Brand (этап A): публичный профиль клиники.
// Элемент галереи. url — R2-ключ или абсолютный CDN-URL (загрузка — этап B).
// ───────────────────────────────────────────────────────────────────────────
const galleryItemSchema = z.object({
  url: z.string().trim().min(1).max(1000),
  caption: z.string().trim().max(300).optional(),
  order: z.number().int().optional(),
});

// ───────────────────────────────────────────────────────────────────────────
// ВИТРИНА 2.0 (V2): тема оформления — ТОЛЬКО ключи (значения живут в словарях).
// .strict() — лишние ключи отвергаются (чистый theme). .partial() — все
// необязательны (частичное обновление палитры/шрифта и т.д.).
// ───────────────────────────────────────────────────────────────────────────
const themeSchema = z
  .object({
    preset: z.enum(PRESET_KEYS),
    palette: z.enum(PALETTE_KEYS),
    fontPair: z.enum(FONT_PAIR_KEYS),
    heroStyle: z.enum(HERO_STYLE_KEYS),
    cardStyle: z.enum(CARD_STYLE_KEYS),
    pageBgStyle: z.enum(PAGE_BG_STYLE_KEYS),
    pageBgDim: z.number().int().min(0).max(92),
    contentWidth: z.number().int().min(380).max(1600),
    heroHeight: z
      .number()
      .int()
      .refine((v) => v === 0 || (v >= 100 && v <= 850), {
        message: "heroHeight must be 0 (auto) or between 100 and 850",
      }),
  })
  .partial()
  .strict();

// ───────────────────────────────────────────────────────────────────────────
// ВИТРИНА 2.0 (V3): layout — раскладка блоков витрины.
// Редактор присылает ПОЛНЫЙ упорядоченный список блоков → на сервисе
// заменяется целиком ($set: { layout }). type валидируем мягко (строка):
// неизвестные типы рендерер игнорирует, схему со списком блоков не связываем.
// config — произвольный объект конфигурации блока (passthrough).
// ───────────────────────────────────────────────────────────────────────────
const layoutBlockSchema = z.object({
  id: z.string().optional(), // _id сабдока (если редактор шлёт обратно)
  type: z.string().trim().min(1).max(40),
  visible: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
  config: z.object({}).passthrough().optional(),
});

const layoutSchema = z
  .object({
    blocks: z.array(layoutBlockSchema).max(50),
  })
  .strict();

/**
 * Schema for POST /clinics
 */
export const createClinicSchema = z.object({
  name: z.string().trim().min(2).max(200),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9-]+$/,
      "Slug can only contain lowercase letters, numbers, and dashes",
    )
    .min(2)
    .max(100)
    .optional(),

  legalName: z.string().trim().max(300).optional(),
  taxId: z.string().trim().max(50).optional(),

  contacts: z
    .object({
      phone: z.string().trim().optional(),
      email: z.string().trim().toLowerCase().email().optional(),
      website: z.string().trim().url().optional(),
    })
    .optional(),

  address: z
    .object({
      country: z.string().trim().length(2).optional(),
      city: z.string().trim().optional(),
      street: z.string().trim().optional(),
      postalCode: z.string().trim().optional(),
      coordinates: z
        .object({
          lat: z.number().min(-90).max(90),
          lng: z.number().min(-180).max(180),
        })
        .optional(),
    })
    .optional(),

  timezone: z.string().trim().default("Asia/Baku"),
  defaultCurrency: z.enum(SUPPORTED_CURRENCIES).default("AZN"),
  defaultLanguage: z.enum(SUPPORTED_LANGUAGES).default("ru"),
  supportedLanguages: z.array(z.enum(SUPPORTED_LANGUAGES)).optional(),

  specializations: z.array(z.string().trim()).optional(),

  // ── Clinic-as-Brand (этап A): публичные brand-поля ──
  // Описание — публичное, до 5000 символов. Пустая строка = очистить.
  description: z.string().trim().max(5000).optional(),
  // Логотип — R2-ключ/URL (загрузка на этапе B). null = убрать.
  logo: z.string().trim().max(1000).nullable().optional(),
  // Галерея фото (наполняется на этапе B).
  gallery: z.array(galleryItemSchema).optional(),

  // ── ВИТРИНА 2.0 (V4.1): brand-поля уровня клиники ──
  // Обложка hero — R2-ключ/URL (загрузка отдельным шагом). null = убрать.
  coverImage: z.string().trim().max(1000).nullable().optional(),
  pageBackground: z.string().trim().max(1000).nullable().optional(),
  slogan: z.string().trim().max(200).optional(),
  callCenterPhone: z.string().trim().max(40).optional(),
  callCenterHours: z.string().trim().max(120).optional(),
  faq: z
    .array(
      z.object({
        q: z.string().trim().max(300),
        a: z.string().trim().max(2000),
      }),
    )
    .max(30)
    .optional(),

  // ── ВИТРИНА 2.0 (V2): тема оформления (ключи) ──
  theme: themeSchema.optional(),

  // ── ВИТРИНА 2.0 (V3): раскладка блоков ──
  layout: layoutSchema.optional(),

  tier: z.enum(TIERS).default("starter"),
});

/**
 * Schema for PATCH /clinics/:id
 * All fields optional, but at least one must be provided.
 *
 * Наследует brand-поля (description/logo/gallery) и theme из createClinicSchema.
 * Заметь: isPublished СЮДА НЕ входит — публикация идёт через отдельный
 * эндпоинт PATCH /clinics/:id/publish (publishClinicSchema).
 */
export const updateClinicSchema = createClinicSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

/**
 * Schema for PATCH /clinics/:id/publish
 * Тумблер видимости публичной страницы /clinic/:slug.
 */
export const publishClinicSchema = z.object({
  isPublished: z.boolean(),
});
