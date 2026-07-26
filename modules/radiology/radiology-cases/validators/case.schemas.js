// server/modules/radiology/radiology-cases/validators/case.schemas.js

import { z } from "zod";
import {
  MODALITIES,
  FINDING_SHAPES,
  SIGNIFICANCES,
  DIFFICULTIES,
  SOURCE_KINDS,
} from "../../constants.js";
import { isKnownFinding } from "../../lexicon/lexicon.js";

const objectIdField = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");
const unit = z.number().min(0).max(1); // нормализованная координата 0..1

// Геометрия разметки: форма coords проверяется по shape. Держим её строгой
// на входе, чтобы скоринг (shapeCenter) мог читать поля без защит.
const geometrySchema = z
  .object({
    shape: z.enum(FINDING_SHAPES),
    coords: z.any(),
  })
  .superRefine((val, ctx) => {
    const c = val.coords ?? {};
    const bad = (message) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ["coords"] });
    if (val.shape === "point") {
      if (!isUnit(c.x) || !isUnit(c.y)) bad("point требует coords {x,y} в 0..1");
    } else if (val.shape === "rect") {
      if (!isUnit(c.x) || !isUnit(c.y) || !isUnit(c.w) || !isUnit(c.h))
        bad("rect требует coords {x,y,w,h} в 0..1");
    } else if (val.shape === "ellipse") {
      if (!isUnit(c.cx) || !isUnit(c.cy) || !isUnit(c.rx) || !isUnit(c.ry))
        bad("ellipse требует coords {cx,cy,rx,ry} в 0..1");
    } else if (val.shape === "polygon") {
      const pts = c.points;
      if (!Array.isArray(pts) || pts.length < 3)
        bad("polygon требует coords {points:[{x,y}]} минимум из 3 точек");
      else if (!pts.every((p) => isUnit(p?.x) && isUnit(p?.y)))
        bad("все точки polygon должны быть {x,y} в 0..1");
    }
  });

function isUnit(n) {
  return typeof n === "number" && n >= 0 && n <= 1;
}

const imageSchema = z.object({
  url: z.string().trim().url().max(1000),
  order: z.number().int().min(0).optional(),
  label: z.string().trim().max(120).optional(),
  width: z.number().int().min(1).nullish(),
  height: z.number().int().min(1).nullish(),
  pixelSpacingMm: z.number().positive().nullish(),
});

const findingSchema = z.object({
  key: z.string().trim().min(1).max(40),
  imageIndex: z.number().int().min(0),
  // Ярлык обязан быть из контролируемого словаря — иначе классификацию не
  // оценить (см. lexicon.js).
  label: z
    .string()
    .trim()
    .refine(isKnownFinding, { message: "Неизвестный ярлык находки (нет в словаре)" }),
  significance: z.enum(SIGNIFICANCES).optional(),
  geometry: geometrySchema,
  required: z.boolean().optional(),
  explanation: z.string().trim().max(2000).optional(),
});

const impressionSchema = z.object({
  correctText: z.string().trim().max(4000).optional(),
  diagnosisKeys: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  diagnosisSynonyms: z
    .array(z.string().trim().min(1).max(120))
    .max(50)
    .optional(),
});

const sourceSchema = z.object({
  kind: z.enum(SOURCE_KINDS),
  authority: z.string().trim().max(300).nullish(),
  url: z.string().trim().url().max(1000).nullish(),
  year: z.number().int().min(1900).max(2200).nullish(),
  licenseNote: z.string().trim().max(2000).nullish(),
});

export const createCaseSchema = z.object({
  modality: z.enum(MODALITIES),
  title: z.string().trim().min(2).max(300),
  clinicalContext: z.string().trim().max(4000).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  categoryId: objectIdField.nullish(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  images: z.array(imageSchema).min(1).max(60),
  findings: z.array(findingSchema).max(50).optional(),
  impression: impressionSchema.optional(),
  source: sourceSchema,
  deidentified: z.boolean().optional(),
});

// Правка черновика: те же поля, но все опциональны и хотя бы одно должно
// присутствовать. modality не даём менять — от неё зависит система чтения
// и весь разбор уже размеченных находок.
export const updateCaseSchema = z
  .object({
    title: z.string().trim().min(2).max(300).optional(),
    clinicalContext: z.string().trim().max(4000).optional(),
    difficulty: z.enum(DIFFICULTIES).optional(),
    categoryId: objectIdField.nullish(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    images: z.array(imageSchema).min(1).max(60).optional(),
    findings: z.array(findingSchema).max(50).optional(),
    impression: impressionSchema.optional(),
    source: sourceSchema.optional(),
    deidentified: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "Нужно передать хотя бы одно поле",
  });

export const reviewCaseSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(2000).optional(),
});

// ИИ-проверка кейса (второй проход). Приходит содержимое формы, а не id:
// рецензировать надо текущую версию автора, возможно ещё не сохранённую.
// plannedFindings — и не размеченные находки из плана ИИ, и уже поставленные
// на снимок (клиент сводит их в один список: важна медицинская суть, а не
// координаты).
export const aiVerifyCaseSchema = z.object({
  modality: z.enum(MODALITIES),
  draft: z.object({
    title: z.string().trim().max(300).optional(),
    clinicalContext: z.string().trim().max(4000).optional(),
    plannedFindings: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(60),
          significance: z.enum(SIGNIFICANCES).optional(),
          location: z.string().trim().max(300).optional(),
          explanation: z.string().trim().max(2000).optional(),
        }),
      )
      .max(30),
    impression: z
      .object({
        correctText: z.string().trim().max(4000).optional(),
        diagnosisKeys: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
        diagnosisSynonyms: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
      })
      .optional(),
  }),
});

// ИИ-генерация кейса ЦЕЛИКОМ по теме (снимка ещё нет — ИИ описывает, какие
// находки на нём должны быть; расставляет их автор на холсте).
export const aiGenerateCaseSchema = z.object({
  modality: z.enum(MODALITIES),
  topic: z.string().trim().min(3).max(500),
  difficulty: z.enum(DIFFICULTIES).optional(),
  hint: z.string().trim().max(1000).optional(),
});

export const listCasesQuerySchema = z.object({
  modality: z.enum(MODALITIES).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  status: z.string().optional(), // валидируется в сервисе по роли
  scope: z.enum(["published", "all"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
