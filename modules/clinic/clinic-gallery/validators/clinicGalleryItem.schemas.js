// server/modules/clinic/clinic-gallery/validators/clinicGalleryItem.schemas.js

import { z } from "zod";

export const createGalleryItemSchema = z
  .object({
    pageId: z.string().trim().min(1),
    image: z.string().trim().min(1),
    caption: z.string().trim().max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    order: z.number().int().min(0).optional(),
  })
  .strict();

// pageId менять нельзя (фото остаётся в своей категории)
export const updateGalleryItemSchema = createGalleryItemSchema
  .omit({ pageId: true })
  .partial()
  .strict();

// массовое изменение порядка: [{id, order}, ...]
export const reorderGallerySchema = z
  .object({
    items: z
      .array(
        z.object({
          id: z.string().trim().min(1),
          order: z.number().int().min(0),
        }),
      )
      .max(200),
  })
  .strict();
