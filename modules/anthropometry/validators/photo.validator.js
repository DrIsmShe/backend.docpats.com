import { z } from "zod";

const VIEW_TYPES = [
  "frontal",
  "lateral_left",
  "lateral_right",
  "oblique_left",
  "oblique_right",
  "basal",
  "superior",
  "frontal_body",
  "lateral_left_body",
  "lateral_right_body",
  "posterior",
  "other",
];

/* ============================================================
   POST /studies/:studyId/photos (multipart/form-data)
   ============================================================
   Файл идёт через multer (req.file), а viewType — через
   req.body. Валидатор проверяет ТОЛЬКО body (viewType). */
export const uploadPhotoBodySchema = z.object({
  viewType: z.enum(VIEW_TYPES),
});

/* ============================================================
   GET /photos/:photoId/url (query)
   ============================================================ */
export const signedUrlQuerySchema = z.object({
  ttlSeconds: z.coerce.number().int().min(60).max(86400).optional(),
});

/* ============================================================
   DELETE /photos/:photoId
   ============================================================ */
export const deletePhotoSchema = z.object({
  reason: z.string().min(10).max(500),
});
