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
  deleteCase,
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
import { readImageStudy, renderImageStudyText } from "../../ai/imageStudyReader.js";
import { getModality, supportsImages } from "../services/registry.js";
import DiagnosticCase from "../models/diagnosticCase.model.js";
import DiagnosticArtifact from "../models/diagnosticArtifact.model.js";
import { trace, traceEgress, describeArtifacts } from "../../audit.js";
import { assertAnalyzeAllowed, assertExtractAllowed, analyzeQuotaLeft } from "../services/quota.service.js";
import HIPAAAuditLog from "../../../audit/models/AuditLog.model.js";
import { enqueueAnalysis } from "../../jobs/analysis.queue.js";
import { renderCaseDocument } from "../services/export.service.js";

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
  trace(req, { action: "diagnostics.case.create", resourceId: doc._id });
  res.status(201).json({ case: doc });
});

export const listCasesController = asyncHandler(async (req, res) => {
  const parsed = listCasesQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) throwZod(parsed);
  const page = await listCases({ userId: req.diagnosticsActor.userId, ...parsed.data });
  trace(req, { action: "diagnostics.case.list", metadata: { returned: page.items.length, total: page.total } });
  res.json({
    items: page.items,
    count: page.items.length,
    total: page.total,
    skip: page.skip,
    limit: page.limit,
    hasMore: page.hasMore,
  });
});

export const getCaseController = asyncHandler(async (req, res) => {
  const full = await getCaseFull(req.params.id, req.diagnosticsActor.userId);
  // Чтение дела — это доступ к PHI, и он подлежит журналированию так же, как
  // чтение карты пациента: «кто открывал» — обязательная часть ответа.
  trace(req, {
    action: "diagnostics.case.read",
    resourceId: req.params.id,
    metadata: {
      artifacts: full.artifacts.length,
      findings: full.findings.length,
      status: full.case?.status,
    },
  });
  res.json(full);
});

export const updateCaseController = asyncHandler(async (req, res) => {
  const parsed = updateCaseSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  const doc = await updateCase(req.params.id, parsed.data, req.diagnosticsActor.userId);

  // Подтверждение гейтов — отдельное событие, а не «обновление дела»:
  // это основание, на котором данные потом уходят наружу, и искать его в
  // общем потоке правок нельзя.
  if (parsed.data.deidentified === true || parsed.data.aiConsent === true) {
    trace(req, {
      action: "diagnostics.consent",
      resourceId: req.params.id,
      metadata: {
        deidentified: Boolean(doc.deidentified),
        aiConsent: Boolean(doc.aiConsent?.confirmed),
      },
    });
  } else {
    trace(req, {
      action: "diagnostics.case.update",
      resourceId: req.params.id,
      metadata: { fields: Object.keys(parsed.data) },
    });
  }
  res.json({ case: doc });
});

export const closeCaseController = asyncHandler(async (req, res) => {
  const parsed = closeCaseSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  const doc = await closeCase(req.params.id, parsed.data, req.diagnosticsActor.userId);
  trace(req, {
    action: "diagnostics.case.close",
    resourceId: req.params.id,
    metadata: { summaryLength: parsed.data.summary.length },
  });
  res.json({ case: doc });
});

export const reopenCaseController = asyncHandler(async (req, res) => {
  const doc = await reopenCase(req.params.id, req.diagnosticsActor.userId);
  trace(req, { action: "diagnostics.case.reopen", resourceId: req.params.id });
  res.json({ case: doc });
});

export const addArtifactController = asyncHandler(async (req, res) => {
  const parsed = addArtifactSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  const doc = await addArtifact(req.params.id, parsed.data, req.diagnosticsActor.userId);
  trace(req, {
    action: "diagnostics.artifact.add",
    resourceType: "diagnostic-artifact",
    resourceId: doc._id,
    metadata: {
      caseId: String(req.params.id),
      kind: doc.kind,
      modality: doc.modality || null,
      textLength: String(doc.text ?? "").length,
      items: parsed.data.structured?.items?.length ?? 0,
    },
  });
  res.status(201).json({ artifact: doc });
});

export const removeArtifactController = asyncHandler(async (req, res) => {
  const out = await removeArtifact(req.params.artifactId, req.diagnosticsActor.userId);
  trace(req, {
    action: "diagnostics.artifact.remove",
    resourceType: "diagnostic-artifact",
    resourceId: req.params.artifactId,
    metadata: { caseId: String(req.params.id) },
  });
  res.json(out);
});

/**
 * Запуск разбора. Задания создаются синхронно (врач сразу видит, что поставлено
 * в работу), а выполняются в фоне: инференс занимает минуты, и держать ради
 * него HTTP-соединение нельзя. Клиент опрашивает состояние через GET дела.
 */
export const analyzeController = asyncHandler(async (req, res) => {
  const parsed = analyzeSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);

  // Предел до постановки заданий: отказать дешевле, чем создать записи и
  // отменять их.
  await assertAnalyzeAllowed(req.diagnosticsActor.userId);

  const jobs = await queueAnalysis({
    caseId: req.params.id,
    userId: req.diagnosticsActor.userId,
    modalities: parsed.data.modalities ?? [],
  });

  // Журнал выхода данных пишется ДО отправки и синхронно. Если журнал
  // недоступен, материалы наружу не уходят: «отправили, а следа нет» — худший
  // из возможных исходов для медицинских данных.
  const artifacts = await DiagnosticArtifact.find({ caseId: req.params.id })
    .select("kind text")
    .lean();
  await traceEgress(req, {
    action: "diagnostics.analyze",
    resourceId: req.params.id,
    metadata: {
      ...describeArtifacts(artifacts),
      modalities: jobs.map((j) => j.modality),
      jobs: jobs.length,
    },
  });

  // Выполнение — в отдельном процессе-воркере: перезапуск API больше не рвёт
  // идущий разбор. Если очередь недоступна (нет Redis), разбираем здесь же,
  // как раньше: это хуже, но несравнимо лучше отказа в работе врачу.
  const queued = await enqueueAnalysis(req.params.id);
  if (!queued) {
    runPendingJobs(req.params.id).catch((err) =>
      logger?.warn?.({ err, caseId: req.params.id }, "diagnostics background run failed"),
    );
  }

  res.status(202).json({
    jobs,
    advisoryNotice: ADVISORY_NOTICE,
    quota: await analyzeQuotaLeft(req.diagnosticsActor.userId),
    queued,
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
  trace(req, {
    action: "diagnostics.finding.verdict",
    resourceType: "diagnostic-finding",
    resourceId: req.params.findingId,
    metadata: {
      verdict: parsed.data.verdict,
      hasCorrection: Boolean(parsed.data.correction?.trim()),
    },
  });
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

  await assertExtractAllowed(HIPAAAuditLog, req.diagnosticsActor.userId);

  // Файл уходит наружу — событие в журнал ДО отправки, синхронно.
  await traceEgress(req, {
    action: "diagnostics.extract",
    resourceId: req.params.id,
    metadata: {
      mime: req.file.mimetype,
      bytes: req.file.size,
      fileNameLength: String(req.file.originalname ?? "").length,
    },
  });

  const hint = typeof req.body?.hint === "string" ? req.body.hint : "";
  const result = await readDocument({
    buffer: req.file.buffer,
    mimeType: req.file.mimetype,
    hint,
  });

  // Чтение САМОГО снимка, а не текста на нём.
  //
  // Делается здесь и только здесь: буфер файла живёт ровно этот запрос, в дело
  // снимки не сохраняются. Это решение о минимизации PHI, и ради чтения
  // изображений его ломать нельзя — хранилище снимков живого пациента совсем
  // другой уровень ответственности, чем хранилище их описаний.
  //
  // Результат кладётся в тот же text, что и распознанный документ: так он
  // проходит по уже работающему пути разбора и отображается существующим
  // интерфейсом без правок на клиенте.
  const modalityKey = typeof req.body?.modality === "string" ? req.body.modality : "";
  const modality = modalityKey ? getModality(modalityKey) : null;
  let imageStudy = null;

  // Когда читать снимок.
  //
  // Требовать от врача явно указать модальность было ошибкой: он выбирает её в
  // форме уже ПОСЛЕ распознавания, а на шаге загрузки поля просто нет. Условие
  // «указана и умеет смотреть» означало бы, что чтение снимков не включается
  // через интерфейс никогда.
  //
  // Поэтому второе условие — по факту: из картинки не извлеклось осмысленного
  // текста. Значит это снимок, а не фотография бланка, и смотреть на него —
  // единственный способ хоть что-то из него получить. Ровно тот случай, с
  // которого всё началось: КТ пазух без единой подписи.
  //
  // Фото заполненного бланка при этом идёт прежним путём: текст извлёкся,
  // читать пиксели незачем.
  const isImage = req.file.mimetype !== "application/pdf";
  const noUsableText = String(result.text ?? "").trim().length < 40;

  if (isImage && (supportsImages(modalityKey) || noUsableText)) {
    try {
      imageStudy = await readImageStudy({
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
        modality,
        hint,
      });
      const described = renderImageStudyText(imageStudy);
      // Текст бланка, если он был, остаётся первым: напечатанное врачом
      // весомее того, что модель разглядела на картинке.
      result.text = result.text?.trim()
        ? `${result.text.trim()}

${described}`
        : described;
    } catch (err) {
      // Снимок не прочитался — это не повод терять распознанный текст.
      logger?.warn?.(
        { err, caseId: req.params.id, modality: modalityKey },
        "image study read failed",
      );
    }
  }

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
    // Отдельно от текста — чтобы интерфейс мог показать чтение снимка иначе,
    // когда до него дойдут руки. Сейчас достаточно того, что оно внутри text.
    imageStudy: imageStudy
      ? { observations: imageStudy.observations, limits: imageStudy.limits }
      : null,
    docKind: result.docKind,
    unreadable: result.unreadable,
    hasPatientIdentity: result.hasPatientIdentity,
    fileName: req.file.originalname ?? "",
    pages: result.pages,
    model: result.model,
    promptVersion: result.promptVersion,
  });
});

/**
 * Выгрузка дела одним документом.
 *
 * Отдаётся файлом и нигде не сохраняется. Событие пишется в журнал синхронно и
 * ДО отдачи: выгрузка — это вынос PHI за пределы системы, такой же значимый,
 * как отправка внешней модели, и след о нём обязателен.
 */
export const exportCaseController = asyncHandler(async (req, res) => {
  const full = await getCaseFull(req.params.id, req.diagnosticsActor.userId);

  await traceEgress(req, {
    action: "diagnostics.export",
    resourceId: req.params.id,
    metadata: {
      findings: full.findings.length,
      artifacts: full.artifacts.length,
      status: full.case?.status,
      closed: Boolean(full.case?.closedAt),
    },
  });

  const { html, fileName } = renderCaseDocument(full);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.send(html);
});

/**
 * Удалить дело со всем содержимым.
 *
 * Запись в журнал идёт СИНХРОННО и ДО удаления — по той же логике, что и
 * отправка данных наружу: если журнал недоступен, дело не удаляется. Иначе
 * возможен худший расклад — данные пациента исчезли, а следа об этом нет.
 *
 * Состав удаляемого пишем в metadata структурой (сколько материалов, выводов,
 * заданий): по этой записи потом видно, что именно потерялось, не храня само
 * содержимое.
 */
export const deleteCaseController = asyncHandler(async (req, res) => {
  const full = await getCaseFull(req.params.id, req.diagnosticsActor.userId);

  await traceEgress(req, {
    action: "diagnostics.case.delete",
    resourceId: req.params.id,
    metadata: {
      artifacts: full.artifacts.length,
      findings: full.findings.length,
      jobs: full.jobs.length,
      status: full.case?.status,
      wasClosed: Boolean(full.case?.closedAt),
    },
  });

  const out = await deleteCase(req.params.id, req.diagnosticsActor.userId);
  res.json(out);
});
