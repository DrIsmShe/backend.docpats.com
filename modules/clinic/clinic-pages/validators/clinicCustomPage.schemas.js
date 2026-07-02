// server/modules/clinic/clinic-pages/validators/clinicCustomPage.schemas.js
//
// Zod-схемы для CRUD кастомных страниц витрины. Блоки валидируются тем же
// контрактом, что и layout витрины (type + passthrough config), чтобы редактор
// слал одинаковую форму и для главной, и для кастомных страниц.

import { z } from "zod";

// Блок страницы — идентичен layoutBlockSchema витрины.
const pageBlockSchema = z.object({
  id: z.string().optional(),
  type: z.string().trim().min(1).max(40),
  visible: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
  config: z.object({}).passthrough().optional(),
});

const layoutSchema = z
  .object({
    blocks: z.array(pageBlockSchema).max(60),
  })
  .strict();

const seoSchema = z
  .object({
    title: z.string().trim().max(200).optional(),
    description: z.string().trim().max(400).optional(),
  })
  .strict();

// slug: буквы/цифры/дефис (после slugify на сервере). До 60 символов.
const slugField = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9-]+$/i, "slug может содержать только буквы, цифры и дефис");

/** POST /pages — создание. slug опционален (сгенерится из title). */
export const createCustomPageSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    slug: slugField.optional(),
    status: z.enum(["draft", "published"]).optional(),
    order: z.number().int().min(0).optional(),
    // null/строка ObjectId. null = корневая категория; задан = подкатегория.
    parentId: z.string().trim().min(1).nullable().optional(),
    layout: layoutSchema.optional(),
    seo: seoSchema.optional(),
  })
  .strict();

/** PATCH /pages/:id — частичное обновление. */
export const updateCustomPageSchema = createCustomPageSchema.partial().strict();

/** PATCH /pages/:id/publish — тумблер публикации. */
export const publishCustomPageSchema = z
  .object({
    status: z.enum(["draft", "published"]),
  })
  .strict();
