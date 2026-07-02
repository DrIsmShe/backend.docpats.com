// server/modules/clinic/clinic-articles/validators/clinicArticle.schemas.js
//
// Zod-схемы для статей клиники. tags/metaKeywords принимаются и как массив,
// и как строка через запятую (редактор шлёт строку) — нормализуем в массив.

import { z } from "zod";

// "a, b, c" | ["a","b"] → ["a","b","c"]
const csvToArray = z.preprocess(
  (v) => {
    if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
    if (typeof v === "string")
      return v
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    return [];
  },
  z.array(z.string().max(60)).max(40),
);

const slugField = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9-]+$/i, "slug: только буквы, цифры, дефис");

export const createArticleSchema = z
  .object({
    pageId: z.string().trim().min(1), // ObjectId страницы-категории
    title: z.string().trim().min(1).max(300),
    slug: slugField.optional(),
    authors: z.string().trim().max(300).optional(),
    excerpt: z.string().trim().max(600).optional(),
    cover: z.string().trim().optional(),
    body: z.string().optional(),
    links: z.string().trim().optional(),
    gallery: z
      .array(
        z.object({
          image: z.string().trim().min(1),
          caption: z.string().trim().max(200).optional(),
          description: z.string().trim().max(2000).optional(),
        }),
      )
      .max(100)
      .optional(),
    tags: csvToArray.optional(),
    metaDescription: z.string().trim().max(400).optional(),
    metaKeywords: csvToArray.optional(),
    status: z.enum(["draft", "published"]).optional(),
    order: z.number().int().min(0).optional(),
  })
  .strict();

// при обновлении pageId менять нельзя (статья остаётся в своей категории)
export const updateArticleSchema = createArticleSchema
  .omit({ pageId: true })
  .partial()
  .strict();

export const publishArticleSchema = z
  .object({ status: z.enum(["draft", "published"]) })
  .strict();

// рубильник проекта (admin)
export const moderateArticleSchema = z
  .object({
    moderation: z.enum(["ok", "disabled"]),
    moderationNote: z.string().trim().max(500).optional(),
  })
  .strict();
