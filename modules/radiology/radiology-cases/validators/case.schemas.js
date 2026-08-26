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

// План находок: чек-лист «что должно быть на снимке», пока разметки нет.
// Ярлык здесь НЕ проверяется по словарю так же строго, как в findingSchema:
// план — это черновик ИИ, а не эталон, и упавшая валидация означала бы
// потерю всего плана целиком. Неизвестный ярлык просто нельзя будет
// перенести на холст.
const plannedFindingSchema = z.object({
  label: z.string().trim().min(1).max(60),
  significance: z.enum(SIGNIFICANCES).optional(),
  location: z.string().trim().max(300).optional(),
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
  // Лимит времени зачётной попытки, секунды. null — берётся значение по
  // станции (attemptPolicy.DEFAULT_TIME_LIMIT_SEC); в тренировке лимита нет.
  timeLimitSec: z.number().int().min(30).max(7200).nullish(),
  categoryId: objectIdField.nullish(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  // Снимок для ЧЕРНОВИКА не обязателен. Раньше здесь стояло min(1), и кейс,
  // придуманный ИИ по теме, нельзя было сохранить, пока автор не найдёт
  // подходящее изображение, — вся текстовая работа жила в форме и терялась
  // при перезагрузке. Публикацию без кадра по-прежнему не пропускает гейт
  // collectPublishBlockers: «нет ни одного кадра».
  images: z.array(imageSchema).max(60).optional(),
  findings: z.array(findingSchema).max(50).optional(),
  plannedFindings: z.array(plannedFindingSchema).max(30).optional(),
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
    timeLimitSec: z.number().int().min(30).max(7200).nullish(),
    categoryId: objectIdField.nullish(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    images: z.array(imageSchema).max(60).optional(),
    findings: z.array(findingSchema).max(50).optional(),
    plannedFindings: z.array(plannedFindingSchema).max(30).optional(),
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
  // Если кейс уже сохранён, его id можно передать — тогда сервер сохранит
  // рецензию в кейсе, и гейт публикации переживёт перезагрузку страницы.
  caseId: z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id").optional(),
  // Если кадр уже загружен — рецензент посмотрит на него и проверит, что кейс
  // написан именно про этот снимок. Без него проверяется только текст.
  imageUrl: z.string().trim().url().max(1000).optional(),
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

// Цикл «правка → перепроверка» (ai/autoFix.js) для лучевого кейса.
//
// Снимок сюда не передаётся намеренно, хотя рецензент на него смотрит:
// замечания вида «на кадре этой находки не видно» правкой текста не лечатся —
// их решает человек, меняя снимок или разметку. Редактор чинит текстовую
// часть, а с «снимочными» замечаниями честно спорит (disputed).
export const aiAutofixCaseSchema = aiVerifyCaseSchema.extend({
  maxRounds: z.number().int().min(1).max(5).optional(),
  // Что именно править. Пусто — сервер рецензирует сам и правит всё найденное;
  // передан список — правится ровно он (кнопка «исправить» у замечания).
  // Принимать список от клиента безопасно: гейт публикации на нём не стоит,
  // результат сервер рецензирует сам и сохраняет свою рецензию.
  issues: z
    .array(
      z.object({
        target: z.string().trim().max(160).optional(),
        severity: z.enum(["error", "warning"]).optional(),
        issue: z.string().trim().min(1).max(1500),
        suggestion: z.string().trim().max(1500).optional(),
      }),
    )
    .max(30)
    .optional(),
  // Указание автора редактору — главнее предложений рецензента.
  hint: z.string().trim().max(1000).optional(),
});

// Запуск агента-доводчика на сохранённом кейсе. Тело почти пустое, и это
// намеренно: черновик агент берёт ИЗ БАЗЫ, а не из формы. Кейс уже сохранён
// вместе со снимком, и брать текст из состояния страницы значило бы дать
// возможность опубликовать одно, показав другое.
export const aiRunAgentSchema = z.object({
  maxRounds: z.number().int().min(1).max(5).optional(),
  // Указание автора редактору — главнее замечаний рецензента.
  hint: z.string().trim().max(1000).optional(),
  // false — только починить текст, публикацию оставить человеку.
  publish: z.boolean().optional(),
  // false — не звать судью по застрявшим замечаниям, оставить их человеку
  // (поведение до появления ai/issueAdjudicator.js).
  resolveIssues: z.boolean().optional(),
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
  // Поиск по названию. Ограничение длины — не косметика: строка уходит в
  // regexp, и осмысленный поиск в 200 символов не помещается.
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  skip: z.coerce.number().int().min(0).max(100000).optional(),
});

// Отметки «разобрано» на замечаниях сохранённой рецензии: индексы в списке.
export const dismissAiIssuesSchema = z.object({
  dismissed: z.array(z.number().int().min(0).max(29)).max(30),
});
