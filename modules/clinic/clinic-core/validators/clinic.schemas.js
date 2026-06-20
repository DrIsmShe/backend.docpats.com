// modules/clinic/clinic-core/validators/clinic.schemas.js
//
// Zod schemas for request validation.

import { z } from "zod";

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

// ───────────────────────────────────────────────────────────────────────────
// Clinic-as-Brand (этап A): публичный профиль клиники.
// Элемент галереи. url — R2-ключ или абсолютный CDN-URL (загрузка — этап B).
// ───────────────────────────────────────────────────────────────────────────
const galleryItemSchema = z.object({
  url: z.string().trim().min(1).max(1000),
  caption: z.string().trim().max(300).optional(),
  order: z.number().int().optional(),
});

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

  tier: z.enum(TIERS).default("starter"),
});

/**
 * Schema for PATCH /clinics/:id
 * All fields optional, but at least one must be provided.
 *
 * Наследует brand-поля (description/logo/gallery) из createClinicSchema.
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
