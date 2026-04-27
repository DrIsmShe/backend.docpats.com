import { z } from "zod";

/* ============================================================
   SHARED ZOD TYPES
   ============================================================
   Переиспользуемые валидаторы для всех модулей. */

// MongoDB ObjectId — 24 hex символа
export const ObjectIdSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "must be a valid ObjectId (24 hex chars)");

// Нормализованная точка 0..1
export const Point2DSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

// Параметры пагинации (для query)
export const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  skip: z.coerce.number().int().min(0).optional(),
  sortBy: z.string().optional(),
  sortOrder: z.coerce
    .number()
    .int()
    .refine((v) => v === 1 || v === -1)
    .optional(),
});

// Валидаторы params со ссылками на ID
export const CaseIdParamsSchema = z.object({
  caseId: ObjectIdSchema,
});

export const StudyIdParamsSchema = z.object({
  studyId: ObjectIdSchema,
});

export const PhotoIdParamsSchema = z.object({
  photoId: ObjectIdSchema,
});

export const AnnotationIdParamsSchema = z.object({
  annotationId: ObjectIdSchema,
});

// Composite — caseId + studyId в URL вложенных ресурсов
export const CaseStudyIdParamsSchema = z.object({
  caseId: ObjectIdSchema,
  studyId: ObjectIdSchema,
});
