// server/modules/education/education-ingest/controllers/ingest.controller.js

import { asyncHandler } from "../../../../common/middlewares/errorHandler.js";
import { ValidationError } from "../../../../common/utils/errors.js";
import {
  createJob,
  startExtraction,
  listJobs,
  getJob,
  deleteJob,
  updateDraft,
  importDrafts,
} from "../services/ingest.service.js";
import { listExtractors } from "../extractors/index.js";
import {
  createJobSchema,
  runExtractionSchema,
  updateDraftSchema,
  importDraftsSchema,
  listJobsQuerySchema,
} from "../validators/ingest.schemas.js";

function throwZod(parsed) {
  throw new ValidationError("Validation failed", {
    issues: parsed.error.issues.map((i) => ({
      path: i.path,
      message: i.message,
    })),
  });
}

// Какие экстракторы доступны и настроены — админский экран импорта.
export const listExtractorsController = asyncHandler(async (req, res) => {
  res.json({ extractors: listExtractors() });
});

export const createJobController = asyncHandler(async (req, res) => {
  const parsed = createJobSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const job = await createJob({
    ...parsed.data,
    actorId: req.educationActor?.userId ?? null,
  });
  res.status(201).json({ job });
});

// Запуск извлечения.
//   multipart с полем "file" — файл уходит экстрактору из памяти;
//   application/json с "items" — вопросы уже разобраны (ручной экстрактор).
export const runExtractionController = asyncHandler(async (req, res) => {
  const parsed = runExtractionSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);

  // Отвечаем сразу, распознавание идёт в фоне: синхронный ответ на 3–4
  // минуты не переживает nginx, и клиент получал «Network Error» на живой
  // работе. Прогресс клиент забирает опросом GET /import/jobs/:id.
  const job = await startExtraction(req.params.id, {
    buffer: req.file?.buffer ?? null,
    payloadItems: parsed.data.items ?? null,
  });
  res.status(202).json({ job });
});

export const listJobsController = asyncHandler(async (req, res) => {
  const parsed = listJobsQuerySchema.safeParse(req.query);
  if (!parsed.success) throwZod(parsed);

  const items = await listJobs(parsed.data);
  res.json({ items, count: items.length });
});

export const getJobController = asyncHandler(async (req, res) => {
  const job = await getJob(req.params.id);
  res.json({ job });
});

// Удаление задания. Разбор распознанного — журнал, а не контент: вопросы,
// уже перенесённые в банк, остаются на месте.
export const deleteJobController = asyncHandler(async (req, res) => {
  const result = await deleteJob(req.params.id);
  res.json(result);
});

export const updateDraftController = asyncHandler(async (req, res) => {
  const parsed = updateDraftSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0) {
    throw new ValidationError("index must be a non-negative integer");
  }

  const job = await updateDraft(req.params.id, index, parsed.data);
  res.json({ job });
});

export const importDraftsController = asyncHandler(async (req, res) => {
  const parsed = importDraftsSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);

  const result = await importDrafts(req.params.id, {
    indexes: parsed.data.indexes ?? null,
    actorId: req.educationActor?.userId ?? null,
  });
  res.json(result);
});
