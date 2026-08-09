// server/modules/radiology/labs-station/lab.schemas.js

import { z } from "zod";
import { ATTEMPT_MODES, DIFFICULTIES, SOURCE_KINDS } from "../constants.js";
import { integritySignalsSchema } from "../radiology-attempts/validators/attempt.schemas.js";

const objectIdField = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

const panelItemSchema = z.object({
  key: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(60),
  unit: z.string().trim().max(40).optional(),
  refRange: z.string().trim().max(60).optional(),
});

const impressionSchema = z.object({
  correctText: z.string().trim().max(4000).optional(),
  diagnosisKeys: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  diagnosisSynonyms: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
});

const sourceSchema = z.object({
  kind: z.enum(SOURCE_KINDS),
  authority: z.string().trim().max(300).nullish(),
  url: z.string().trim().url().max(1000).nullish(),
  licenseNote: z.string().trim().max(2000).nullish(),
});

// Числовой вариант кейса: тот же диагноз, другие значения. Ключи показателей
// обязаны существовать в основной панели — вариант переопределяет значения, а
// не описывает другой кейс (проверяется в variantPicker/нормализации ИИ).
const labVariantSchema = z.object({
  label: z.string().trim().max(60).optional(),
  note: z.string().trim().max(500).optional(),
  panel: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(40),
        value: z.string().trim().min(1).max(60),
        unit: z.string().trim().max(40).optional(),
        refRange: z.string().trim().max(60).optional(),
      }),
    )
    .max(40),
  significantAbnormal: z.array(z.string().trim().min(1).max(40)).max(40).optional(),
});

// Запрос на ИИ-генерацию вариантов: сколько сделать.
export const aiVariantsSchema = z.object({
  count: z.number().int().min(1).max(4).optional(),
});

export const createLabSchema = z.object({
  title: z.string().trim().min(2).max(300),
  // Лимит времени зачётной попытки, секунды. null — берётся значение по
  // станции (attemptPolicy.DEFAULT_TIME_LIMIT_SEC); в тренировке лимита нет.
  timeLimitSec: z.number().int().min(30).max(7200).nullish(),
  clinicalContext: z.string().trim().max(4000).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  categoryId: objectIdField.nullish(),
  panel: z.array(panelItemSchema).min(1).max(40),
  variants: z.array(labVariantSchema).max(4).optional(),
  significantAbnormal: z.array(z.string().trim().min(1).max(40)).max(40).optional(),
  impression: impressionSchema.optional(),
  source: sourceSchema,
});

export const updateLabSchema = z
  .object({
    title: z.string().trim().min(2).max(300).optional(),
    clinicalContext: z.string().trim().max(4000).optional(),
    difficulty: z.enum(DIFFICULTIES).optional(),
    timeLimitSec: z.number().int().min(30).max(7200).nullish(),
    categoryId: objectIdField.nullish(),
    panel: z.array(panelItemSchema).min(1).max(40).optional(),
    variants: z.array(labVariantSchema).max(4).optional(),
    significantAbnormal: z.array(z.string().trim().min(1).max(40)).max(40).optional(),
    impression: impressionSchema.optional(),
    source: sourceSchema.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Нужно хотя бы одно поле" });

export const statusLabSchema = z.object({
  status: z.enum(["draft", "published", "archived"]),
});

export const startLabSchema = z.object({
  mode: z.enum(ATTEMPT_MODES).optional(),
});

export const labPolicyQuerySchema = z.object({
  mode: z.enum(ATTEMPT_MODES).optional(),
});

export const submitLabSchema = z.object({
  flags: z.array(z.string().trim().min(1).max(40)).max(40).optional(),
  // Сигналы добросовестности: вставки в поля, уход со вкладки. Не доверенные,
  // на балл не влияют (integrity.service.js).
  integrity: integritySignalsSchema,
  impressionText: z.string().trim().max(4000).optional(),
  // Ключи от учащегося: клиент присылает и фразу целиком, и отдельные слова.
  // 400 вместо 120 — развёрнутая клиническая формулировка («…активная стадия
  // (DAS28 > 5,1), эрозивная форма, II рентгенологическая стадия…») длиннее
  // 120 символов, и раньше сдача падала в 400, теряя ответ.
  diagnosisKeys: z.array(z.string().trim().min(1).max(400)).max(40).optional(),
  // Формулировка целиком — по ней диагноз и оценивается (diagnosisMatcher).
  diagnosisText: z.string().trim().max(4000).optional(),
});

// Запрос на ИИ-проверку кейса (второй проход). Проверяем ТО, ЧТО СЕЙЧАС В
// ФОРМЕ, а не то, что когда-то вернул генератор: автор мог уже поправить
// цифры, и рецензировать надо его версию. Поэтому кейс приходит целиком, а
// не по id — он ещё может быть не сохранён.
export const aiVerifyLabSchema = z.object({
  // Если кейс уже сохранён, его id можно передать — тогда сервер сохранит
  // рецензию в кейсе, и гейт публикации переживёт перезагрузку страницы.
  caseId: z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id").optional(),
  draft: z.object({
    title: z.string().trim().max(300).optional(),
    clinicalContext: z.string().trim().max(4000).optional(),
    panel: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(120),
          value: z.string().trim().min(1).max(60),
          unit: z.string().trim().max(40).optional(),
          refRange: z.string().trim().max(60).optional(),
          significant: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(40),
    impression: impressionSchema.optional(),
  }),
});

// Запрос на цикл «правка → перепроверка» (ai/autoFix.js). Форма та же, что у
// проверки: правится ТО, ЧТО СЕЙЧАС В ФОРМЕ. caseId обязателен не всегда —
// несохранённый кейс тоже можно исправить, он просто не запишется в базу.
export const aiAutofixLabSchema = aiVerifyLabSchema.extend({
  // Сколько кругов максимум. Круг — два вызова Opus с рассуждением, поэтому
  // потолок жёсткий: кейс, не сошедшийся за пять кругов, упирается в спор по
  // существу, и следующий круг его не решит.
  maxRounds: z.number().int().min(1).max(5).optional(),
});

// Запрос на ИИ-генерацию кейса целиком: тема обязательна, остальное — подсказки.
export const aiGenerateLabSchema = z.object({
  topic: z.string().trim().min(3).max(500),
  difficulty: z.enum(DIFFICULTIES).optional(),
  hint: z.string().trim().max(1000).optional(),
});

export const listLabQuerySchema = z.object({
  scope: z.enum(["published", "all"]).optional(),
  status: z.string().optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  // Поиск и постраничность — как на станции снимков. Форма параметров у всех
  // станций одна: интерфейс каталога переключает станции, не меняя запрос.
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  skip: z.coerce.number().int().min(0).max(100000).optional(),
});

// Отметки «разобрано» на замечаниях сохранённой рецензии: индексы в списке.
export const dismissAiIssuesSchema = z.object({
  dismissed: z.array(z.number().int().min(0).max(29)).max(30),
});
