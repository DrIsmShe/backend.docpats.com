// server/modules/diagnostics/core/controllers/diagnostics.controller.js

import { asyncHandler } from "../../../../common/middlewares/errorHandler.js";
import { ValidationError, NotFoundError } from "../../../../common/utils/errors.js";
import logger from "../../../../common/logger.js";
import { describeModalities } from "../services/registry.js";
import { describeAnalytes } from "../../labs/labRules.js";
import {
  createCase,
  listCases,
  getCaseFull,
  updateCase,
  closeCase,
  reopenCase,
  addArtifact,
  removeArtifact,
  setFindingVerdict,
  feedbackStats,
} from "../services/case.service.js";
import {
  queueAnalysis,
  runPendingJobs,
  runJob,
} from "../services/analysis.service.js";
import {
  createCaseSchema,
  updateCaseSchema,
  addArtifactSchema,
  analyzeSchema,
  closeCaseSchema,
  verdictSchema,
  listCasesQuerySchema,
} from "../validators/diagnostics.schemas.js";
import { ADVISORY_NOTICE } from "../../constants.js";
import { readDocument } from "../../ai/documentReader.js";
import DiagnosticCase from "../models/diagnosticCase.model.js";

function throwZod(parsed) {
  throw new ValidationError("Validation failed", {
    issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
  });
}

/** Справочник подмодулей: что умеет каждая модальность и по какому протоколу. */
export const listModalitiesController = asyncHandler(async (req, res) => {
  res.json({ modalities: describeModalities(), advisoryNotice: ADVISORY_NOTICE });
});

/**
 * Показатели, которые модуль узнаёт по ключу.
 *
 * Отдаём отдельным справочником, потому что ключ — рабочее поле, а не подпись:
 * по нему срабатывают пороги критических значений и связки показателей. Если
 * бы этот список жил на клиенте своей копией, добавленный здесь показатель
 * молча не появлялся бы в форме ввода панели.
 */
export const listAnalytesController = asyncHandler(async (req, res) => {
  res.json({ analytes: describeAnalytes() });
});

export const createCaseController = asyncHandler(async (req, res) => {
  const parsed = createCaseSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  const doc = await createCase(parsed.data, {
    userId: req.diagnosticsActor.userId,
    clinicId: req.diagnosticsActor.clinicId ?? null,
  });
  res.status(201).json({ case: doc });
});

export const listCasesController = asyncHandler(async (req, res) => {
  const parsed = listCasesQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) throwZod(parsed);
  const items = await listCases({ userId: req.diagnosticsActor.userId, ...parsed.data });
  res.json({ items, count: items.length });
});

export const getCaseController = asyncHandler(async (req, res) => {
  res.json(await getCaseFull(req.params.id, req.diagnosticsActor.userId));
});

export const updateCaseController = asyncHandler(async (req, res) => {
  const parsed = updateCaseSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  res.json({ case: await updateCase(req.params.id, parsed.data, req.diagnosticsActor.userId) });
});

export const closeCaseController = asyncHandler(async (req, res) => {
  const parsed = closeCaseSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  res.json({ case: await closeCase(req.params.id, parsed.data, req.diagnosticsActor.userId) });
});

export const reopenCaseController = asyncHandler(async (req, res) => {
  res.json({ case: await reopenCase(req.params.id, req.diagnosticsActor.userId) });
});

export const addArtifactController = asyncHandler(async (req, res) => {
  const parsed = addArtifactSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  const doc = await addArtifact(req.params.id, parsed.data, req.diagnosticsActor.userId);
  res.status(201).json({ artifact: doc });
});

export const removeArtifactController = asyncHandler(async (req, res) => {
  res.json(await removeArtifact(req.params.artifactId, req.diagnosticsActor.userId));
});

/**
 * Запуск разбора. Задания создаются синхронно (врач сразу видит, что поставлено
 * в работу), а выполняются в фоне: инференс занимает минуты, и держать ради
 * него HTTP-соединение нельзя. Клиент опрашивает состояние через GET дела.
 */
export const analyzeController = asyncHandler(async (req, res) => {
  const parsed = analyzeSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);

  const jobs = await queueAnalysis({
    caseId: req.params.id,
    userId: req.diagnosticsActor.userId,
    modalities: parsed.data.modalities ?? [],
  });

  // Намеренно без await: ответ уходит сразу. Ошибки внутри runPendingJobs
  // фиксируются в самих заданиях, поэтому здесь только логируем сбой запуска.
  runPendingJobs(req.params.id).catch((err) =>
    logger?.warn?.({ err, caseId: req.params.id }, "diagnostics background run failed"),
  );

  res.status(202).json({
    jobs,
    advisoryNotice: ADVISORY_NOTICE,
    message: "Разбор запущен. Результаты появятся в деле по мере готовности.",
  });
});

/** Перезапуск одного задания — например, после сбоя внешнего сервиса. */
export const rerunJobController = asyncHandler(async (req, res) => {
  const job = await runJob(req.params.jobId);
  res.json({ job });
});

export const verdictController = asyncHandler(async (req, res) => {
  const parsed = verdictSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  const finding = await setFindingVerdict(
    req.params.findingId,
    parsed.data,
    req.diagnosticsActor.userId,
  );
  res.json({ finding });
});

export const statsController = asyncHandler(async (req, res) => {
  res.json({ byModality: await feedbackStats(req.diagnosticsActor.userId) });
});

/**
 * Распознавание документа: фото бланка или PDF → текст.
 *
 * Файл НЕ сохраняется: он живёт в памяти на время запроса, наружу уходит
 * только текст. В дело он попадёт отдельным действием врача — после того как
 * тот прочитает распознанное и поправит. Автоматически добавлять нельзя:
 * ошибка в одной цифре анализа меняет вывод, а проверить её может только
 * человек, у которого перед глазами оригинал.
 *
 * Гейты те же, что у разбора, и по той же причине: файл уходит внешней модели.
 * Отдельного «согласия на распознавание» нет намеренно — это то же самое
 * согласие, а лишний флажок превращает осознанное решение в рутину.
 */
export const extractDocumentController = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new ValidationError("Файл не приложен");
  }

  const caseDoc = await DiagnosticCase.findOne({
    _id: req.params.id,
    ownerId: req.diagnosticsActor.userId,
  }).lean();
  if (!caseDoc) throw new NotFoundError("Дело не найдено");
  if (caseDoc.status === "closed") {
    throw new ValidationError("Дело закрыто — переоткройте его, чтобы добавить материалы");
  }

  const blockers = [];
  if (!caseDoc.deidentified) {
    blockers.push("подтвердите, что материалы обезличены");
  }
  if (!caseDoc.aiConsent?.confirmed) {
    blockers.push("подтвердите согласие на обработку внешней моделью");
  }
  if (blockers.length) {
    throw new ValidationError(`Распознавание не запущено: ${blockers.join("; ")}`, {
      blockers,
    });
  }

  const result = await readDocument({
    buffer: req.file.buffer,
    mimeType: req.file.mimetype,
    hint: typeof req.body?.hint === "string" ? req.body.hint : "",
  });

  logger?.info?.(
    {
      caseId: req.params.id,
      // Структурные данные, без содержимого: PHI в логах не место.
      mime: req.file.mimetype,
      bytes: req.file.size,
      pages: result.pages,
      textLength: result.text.length,
      unreadable: result.unreadable.length,
    },
    "diagnostics document extracted",
  );

  res.json({
    text: result.text,
    docKind: result.docKind,
    unreadable: result.unreadable,
    hasPatientIdentity: result.hasPatientIdentity,
    fileName: req.file.originalname ?? "",
    pages: result.pages,
    model: result.model,
    promptVersion: result.promptVersion,
  });
});
