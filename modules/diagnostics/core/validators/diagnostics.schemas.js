// server/modules/diagnostics/core/validators/diagnostics.schemas.js

import { z } from "zod";
import {
  ARTIFACT_KINDS,
  CASE_STATUSES,
  FINDING_VERDICTS,
  MODALITY_KEYS,
} from "../../constants.js";

const objectIdField = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

const patientSchema = z.object({
  kind: z.enum(["clinic_patient", "external", "anonymous"]).optional(),
  patientId: objectIdField.nullish(),
  // Метка, а не ФИО. Ограничение длины здесь заодно намекает, что это метка.
  label: z.string().trim().max(200).optional(),
  ageYears: z.number().int().min(0).max(130).nullish(),
  sex: z.enum(["male", "female", "other", "unknown"]).optional(),
});

export const createCaseSchema = z.object({
  title: z.string().trim().max(300).optional(),
  question: z.string().trim().max(2000).optional(),
  clinicalContext: z.string().trim().max(20000).optional(),
  patient: patientSchema.optional(),
});

export const updateCaseSchema = z
  .object({
    title: z.string().trim().max(300).optional(),
    question: z.string().trim().max(2000).optional(),
    clinicalContext: z.string().trim().max(20000).optional(),
    patient: patientSchema.optional(),
    // Гейты перед отправкой материалов внешней модели.
    deidentified: z.boolean().optional(),
    aiConsent: z.boolean().optional(),
    doctorSummary: z.string().trim().max(20000).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Нужно хотя бы одно поле" });

// Показатель лабораторной панели. Значение строкой: бывает «отрицательный»,
// «следы», «<0.01» — числом это не выразить, а терять нельзя.
const labItemSchema = z.object({
  key: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(160),
  value: z.union([z.string().trim().max(60), z.number()]),
  unit: z.string().trim().max(40).optional(),
  refLow: z.number().nullish(),
  refHigh: z.number().nullish(),
  refText: z.string().trim().max(60).optional(),
});

export const addArtifactSchema = z
  .object({
    kind: z.enum(ARTIFACT_KINDS),
    modality: z.enum(MODALITY_KEYS).optional(),
    url: z.string().trim().max(1000).optional(),
    mime: z.string().trim().max(120).optional(),
    sizeBytes: z.number().int().min(0).nullish(),
    fileName: z.string().trim().max(300).optional(),
    text: z.string().trim().max(60000).optional(),
    structured: z.object({ items: z.array(labItemSchema).max(120) }).nullish(),
    deidentified: z.boolean().optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .refine(
    (d) => Boolean(d.text?.trim()) || Boolean(d.url?.trim()) || Boolean(d.structured),
    { message: "Материал пуст: нужен текст, файл или структурированные данные" },
  );

export const analyzeSchema = z.object({
  // Пусто — сервис сам решит по составу материалов.
  modalities: z.array(z.enum(MODALITY_KEYS)).max(10).optional(),
});

export const closeCaseSchema = z.object({
  summary: z.string().trim().min(3).max(20000),
});

export const verdictSchema = z.object({
  // pending исключён: это исходное состояние, а не решение врача.
  verdict: z.enum(FINDING_VERDICTS.filter((v) => v !== "pending")),
  correction: z.string().trim().max(4000).optional(),
});

export const listCasesQuerySchema = z.object({
  status: z.enum(CASE_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  skip: z.coerce.number().int().min(0).max(100000).optional(),
});
