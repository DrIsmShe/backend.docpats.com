// server/modules/clinic/clinic-services/validators/service.schemas.js
//
// ВИТРИНА 2.0 (V4.2) — Zod-схемы услуг клиники.
// Зеркалят department.schemas.js по стилю. Поля прайса добавлены.
//
// priceType решает смысл price/priceMax — но кросс-валидацию (range требует
// priceMax > price и т.п.) делаем мягко в сервисе, чтобы не блокировать
// частичные update. Здесь только формат/границы.

import { z } from "zod";

const PRICE_TYPES = ["fixed", "from", "range", "on_request", "free"];
const STATUSES = ["active", "archived"];

// ObjectId-строка (24 hex) — как в department.schemas (предполагаемый паттерн).
const objectId = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{24}$/i, "Invalid id");

// nullable ObjectId: принимаем "", null, undefined → null
const nullableObjectId = z
  .union([objectId, z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

const nonNegNumber = z.number().min(0);

// nullable число ≥ 0: принимаем null/undefined → null
const nullableNonNeg = z
  .union([nonNegNumber, z.null()])
  .optional()
  .transform((v) => (typeof v === "number" ? v : null));

// ── CREATE ────────────────────────────────────────────────
export const createServiceSchema = z.object({
  name: z.string().trim().min(1, "name required").max(200),
  code: z
    .string()
    .trim()
    .max(32)
    .optional()
    .transform((v) => (v ? v.toUpperCase() : undefined)),
  description: z.string().trim().max(2000).optional(),

  departmentId: nullableObjectId,
  branchId: nullableObjectId,

  priceType: z.enum(PRICE_TYPES).optional(), // default в модели = fixed
  price: nullableNonNeg,
  priceMax: nullableNonNeg,
  currency: z
    .string()
    .trim()
    .length(3)
    .optional()
    .transform((v) => (v ? v.toUpperCase() : undefined)),
  durationMinutes: nullableNonNeg,

  order: z.number().int().optional(),
  status: z.enum(STATUSES).optional(),
});

// ── UPDATE (всё опционально, минимум 1 поле) ──────────────
export const updateServiceSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    code: z
      .union([z.string().trim().max(32), z.literal(""), z.null()])
      .optional()
      .transform((v) => {
        if (v === "" || v === null) return null; // явная очистка кода
        return v ? v.toUpperCase() : undefined;
      }),
    description: z.string().trim().max(2000).optional(),

    departmentId: nullableObjectId,
    branchId: nullableObjectId,

    priceType: z.enum(PRICE_TYPES).optional(),
    price: nullableNonNeg,
    priceMax: nullableNonNeg,
    currency: z
      .union([z.string().trim().length(3), z.literal(""), z.null()])
      .optional()
      .transform((v) => {
        if (v === "" || v === null) return null;
        return v ? v.toUpperCase() : undefined;
      }),
    durationMinutes: nullableNonNeg,

    order: z.number().int().optional(),
    status: z.enum(STATUSES).optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "At least one field required",
  });

// ── LIST query ────────────────────────────────────────────
export const listServicesQuerySchema = z.object({
  status: z.enum(STATUSES).optional(),
  departmentId: objectId.optional(),
  branchId: objectId.optional(),
  q: z.string().trim().max(200).optional(),
});

// ── :id param ─────────────────────────────────────────────
export const serviceIdParamSchema = z.object({
  id: objectId,
});
