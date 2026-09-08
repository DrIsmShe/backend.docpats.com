// server/modules/video/validators/videoAdmin.schemas.js
//
// Схемы админских действий над каталогом.
//
// ОТЛИЧИЕ ОТ ОБЫЧНЫХ СХЕМ: здесь можно менять видимость. Владельцу это
// закрыто (открыть ролик — отдельное действие publish со своими
// проверками), но администратор снимает материал с витрины именно сменой
// видимости, и заставлять его публиковать от чужого имени бессмысленно.

import { z } from "zod";
import { VIDEO_KINDS, VIDEO_LOCALES, VIDEO_LICENSES } from "../constants.js";

const attributionItem = z.object({
  title: z.string().trim().min(1).max(300),
  author: z.string().trim().max(300).optional(),
  license: z.enum(VIDEO_LICENSES),
  url: z.string().trim().max(1000).optional(),
});

export const adminUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().trim().max(5000).optional(),
    lang: z.enum(VIDEO_LOCALES).optional(),
    kind: z.enum(VIDEO_KINDS).optional(),
    phi: z.boolean().optional(),
    visibility: z.enum(["private", "clinic", "link", "public"]).optional(),
    attribution: z.array(attributionItem).max(20).optional(),
    // Полка витрины. null снимает ролик с полки, не удаляя его.
    categoryId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/)
      .nullable()
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Нечего менять" });

/** Причина обязательна: это чужой материал, и решение должно быть объяснено. */
export const adminReasonSchema = z.object({
  reason: z.string().trim().min(3, "Укажите причину").max(500),
});

/**
 * Раздел витрины.
 *
 * Обязателен только русский заголовок: требовать пять переводов ради одной
 * полки — верный способ получить полку с названием, где через пробел
 * перечислены все языки сразу.
 */
const titleSchema = z.object({
  ru: z.string().trim().min(1, "Название обязательно").max(80),
  en: z.string().trim().max(80).optional(),
  az: z.string().trim().max(80).optional(),
  tr: z.string().trim().max(80).optional(),
  ar: z.string().trim().max(80).optional(),
});

export const categorySchema = z.object({
  // Ключ уходит в адрес страницы, поэтому только латиница и дефис.
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,40}$/, "Ключ — латиница, цифры и дефис, 2-40 знаков"),
  title: titleSchema,
  order: z.number().min(0).max(10000).optional(),
  active: z.boolean().optional(),
});

export const categoryPatchSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9-]{2,40}$/)
      .optional(),
    title: titleSchema.partial().optional(),
    order: z.number().min(0).max(10000).optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Нечего менять" });

export const adminListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(["draft", "processing", "ready", "failed"]).optional(),
  visibility: z.enum(["private", "clinic", "link", "public"]).optional(),
  phi: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  // "all" — вместе с архивом, true — только архив, иначе только живые.
  archived: z.enum(["true", "false", "all"]).optional().transform((v) => {
    if (v === "true") return true;
    if (v === "all") return "all";
    return false;
  }),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export default {
  adminUpdateSchema,
  adminReasonSchema,
  adminListQuerySchema,
  categorySchema,
  categoryPatchSchema,
};
