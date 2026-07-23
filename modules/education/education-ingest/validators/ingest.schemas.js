// server/modules/education/education-ingest/validators/ingest.schemas.js

import { z } from "zod";
import {
  IMPORT_STATUSES,
  IMPORT_MIME_TYPES,
  ITEM_TYPES,
  ITEM_DIFFICULTIES,
  EXAM_LANGUAGES,
  SOURCE_KINDS,
} from "../../constants.js";

const objectIdField = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

const sourceSchema = z.object({
  kind: z.enum(SOURCE_KINDS),
  authority: z.string().trim().max(300).nullish(),
  url: z.string().trim().url().max(1000).nullish(),
  year: z.number().int().min(1900).max(2200).nullish(),
  licenseNote: z.string().trim().max(2000).nullish(),
});

// ─── CREATE JOB ───
export const createJobSchema = z.object({
  programId: objectIdField,
  extractor: z.enum(["manual", "claude"]).optional(),
  // Блок file целиком необязателен: ручной экстрактор работает без файла.
  file: z
    .object({
      // Свободная строка, а не enum: реальную пригодность файла проверяет
      // fileTypes.js по MIME и расширению — браузерному типу верить нельзя.
      mimeType: z.string().trim().max(150).nullish(),
      originalName: z.string().trim().max(300).nullish(),
      // Внешняя ссылка на оригинал — сервер сам исходник не хранит.
      url: z.string().trim().url().max(1000).nullish(),
      key: z.string().trim().max(500).nullish(),
      sizeBytes: z.number().int().min(0).nullish(),
      pageCount: z.number().int().min(1).nullish(),
    })
    .optional(),
  defaults: z
    .object({
      lang: z.enum(EXAM_LANGUAGES).optional(),
      topicCode: z.string().trim().max(80).nullish(),
      difficulty: z.enum(ITEM_DIFFICULTIES).optional(),
      source: sourceSchema.optional(),
    })
    .optional(),
});

// ─── GENERATE (модель пишет вопросы по теме) ───
export const generateSchema = z.object({
  // Тест-контейнер: новый создаём отдельно на клиенте (как в импорте),
  // сюда приходит уже его id.
  programId: objectIdField,
  topic: z.string().trim().min(2).max(500),
  count: z.number().int().min(1).max(500),
  lang: z.enum(EXAM_LANGUAGES).optional(),
  difficulty: z.enum([...ITEM_DIFFICULTIES, "mixed"]).optional(),
  // Необязательная пометка о происхождении («по мотивам открытого банка X»).
  sourceNote: z.string().trim().max(2000).nullish(),
});

// ─── RUN (ручной экстрактор: вопросы приходят готовыми) ───
const manualDraftSchema = z.object({
  stem: z.string().trim().min(1).max(8000),
  options: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(4),
        text: z.string().trim().min(1).max(2000),
      }),
    )
    .min(2)
    .max(10),
  correctKeys: z.array(z.string().trim().min(1).max(4)).max(10).optional(),
  explanation: z.string().trim().max(8000).optional(),
  topicCode: z.string().trim().max(80).nullish(),
  sourcePage: z.number().int().min(1).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

export const runExtractionSchema = z.object({
  items: z.array(manualDraftSchema).max(500).optional(),
});

// ─── UPDATE DRAFT ───
export const updateDraftSchema = z
  .object({
    type: z.enum(ITEM_TYPES).optional(),
    stem: z.string().trim().min(1).max(8000).optional(),
    options: z
      .array(
        z.object({
          key: z.string().trim().min(1).max(4),
          text: z.string().trim().min(1).max(2000),
          explanation: z.string().trim().max(4000).optional(),
        }),
      )
      .min(2)
      .max(10)
      .optional(),
    correctKeys: z.array(z.string().trim().min(1).max(4)).max(10).optional(),
    explanation: z.string().trim().max(8000).optional(),
    topicCode: z.string().trim().max(80).nullish(),
    difficulty: z.enum(ITEM_DIFFICULTIES).optional(),
    discarded: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field must be provided",
  });

// ─── IMPORT ───
export const importDraftsSchema = z.object({
  // null / отсутствие = импортировать всё неотбракованное.
  indexes: z.array(z.number().int().min(0)).max(500).optional(),
});

// ─── LIST QUERY ───
export const listJobsQuerySchema = z.object({
  programId: objectIdField.optional(),
  status: z.enum(IMPORT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
