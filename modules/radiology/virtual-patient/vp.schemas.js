// server/modules/radiology/virtual-patient/vp.schemas.js

import { z } from "zod";
import { ATTEMPT_MODES, DIFFICULTIES, SOURCE_KINDS } from "../constants.js";
import { integritySignalsSchema } from "../radiology-attempts/validators/attempt.schemas.js";

const objectIdField = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

const investigationSchema = z.object({
  key: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().max(60).optional(),
  resultText: z.string().trim().max(4000).optional(),
  imageUrl: z.string().trim().max(1000).nullish(),
  necessary: z.boolean().optional(),
});

const diagnosisSchema = z.object({
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

export const createVpSchema = z.object({
  title: z.string().trim().min(2).max(300),
  // Лимит времени зачётной попытки, секунды. null — берётся значение по
  // станции (attemptPolicy.DEFAULT_TIME_LIMIT_SEC); в тренировке лимита нет.
  timeLimitSec: z.number().int().min(30).max(7200).nullish(),
  presentation: z.string().trim().max(4000).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  categoryId: objectIdField.nullish(),
  investigations: z.array(investigationSchema).min(1).max(30),
  diagnosis: diagnosisSchema.optional(),
  source: sourceSchema,
});

export const updateVpSchema = z
  .object({
    title: z.string().trim().min(2).max(300).optional(),
    presentation: z.string().trim().max(4000).optional(),
    difficulty: z.enum(DIFFICULTIES).optional(),
    timeLimitSec: z.number().int().min(30).max(7200).nullish(),
    categoryId: objectIdField.nullish(),
    investigations: z.array(investigationSchema).min(1).max(30).optional(),
    diagnosis: diagnosisSchema.optional(),
    source: sourceSchema.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Нужно хотя бы одно поле" });

export const statusVpSchema = z.object({
  status: z.enum(["draft", "published", "archived"]),
});

export const orderVpSchema = z.object({
  key: z.string().trim().min(1).max(40),
});

export const startVpSchema = z.object({
  mode: z.enum(ATTEMPT_MODES).optional(),
});

export const vpPolicyQuerySchema = z.object({
  mode: z.enum(ATTEMPT_MODES).optional(),
});

// Предварительный дифдиагноз: короткий список, а не заключение. Ограничение
// длины здесь заодно и педагогическое — просят перечислить версии, а не
// написать эссе.
export const commitVpSchema = z.object({
  text: z.string().trim().min(2).max(2000),
});

export const submitVpSchema = z.object({
  // Ключи от учащегося: клиент присылает и фразу целиком, и отдельные слова.
  // 400 вместо 120 — развёрнутая клиническая формулировка («…активная стадия
  // (DAS28 > 5,1), эрозивная форма, II рентгенологическая стадия…») длиннее
  // 120 символов, и раньше сдача падала в 400, теряя ответ.
  diagnosisKeys: z.array(z.string().trim().min(1).max(400)).max(40).optional(),
  // Формулировка целиком — по ней диагноз и оценивается (diagnosisMatcher).
  diagnosisText: z.string().trim().max(4000).optional(),
  reasoningText: z.string().trim().max(4000).optional(),
  integrity: integritySignalsSchema,
});

// Запрос на ИИ-проверку сценария (второй проход). Приходит содержимое формы,
// а не id: рецензировать надо текущую версию автора, ещё не сохранённую.
export const aiVerifyVpSchema = z.object({
  draft: z.object({
    title: z.string().trim().max(300).optional(),
    presentation: z.string().trim().max(4000).optional(),
    investigations: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(160),
          category: z.string().trim().max(60).optional(),
          resultText: z.string().trim().max(4000).optional(),
          necessary: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(30),
    diagnosis: diagnosisSchema.optional(),
  }),
});

// Запрос на ИИ-генерацию сценария целиком: тема обязательна, остальное — подсказки.
export const aiGenerateVpSchema = z.object({
  topic: z.string().trim().min(3).max(500),
  difficulty: z.enum(DIFFICULTIES).optional(),
  hint: z.string().trim().max(1000).optional(),
});

export const listVpQuerySchema = z.object({
  scope: z.enum(["published", "all"]).optional(),
  status: z.string().optional(),
});
