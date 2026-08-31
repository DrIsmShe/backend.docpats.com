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
import {
  readImageStudy,
  renderImageStudyText,
  shouldReadImage,
} from "../../ai/imageStudyReader.js";
import { looksLikeDicom, readDicom, describeDicomStudy } from "../../ai/dicomReader.js";
import { normalizeLang } from "../../ai/language.js";
import { getModality, supportsImages } from "../services/registry.js";
import DiagnosticCase from "../models/diagnosticCase.model.js";
import DiagnosticArtifact from "../models/diagnosticArtifact.model.js";
import { trace, traceEgress, describeArtifacts } from "../../audit.js";
import { assertAnalyzeAllowed, assertExtractAllowed, analyzeQuotaLeft } from "../services/quota.service.js";
import HIPAAAuditLog from "../../../audit/models/AuditLog.model.js";
import { enqueueAnalysis } from "../../jobs/analysis.queue.js";
import { renderCaseDocument } from "../services/export.service.js";
import { tReq } from "../../../../common/i18n/index.js";
import { errorText } from "../../../../common/i18n/index.js";

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
    // Язык врача. Если клиент его не прислал — русский, как было раньше.
    lang: parsed.data.lang ?? "ru",
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
    message: tReq(req, "app.analysis.started"),
  });
});

/** Перезапуск одного задания — например, после сбоя внешнего сервиса. */
export const rerunJobController = asyncHandler(async (req, res) => {
  // Перезапуск — единственный способ получить старое дело на своём языке:
  // выводы лежат в базе готовым текстом и задним числом не переводятся.
  // Без lang в теле задание перезапускается на том языке, на котором его
  // делали изначально.
  const job = await runJob(req.params.jobId, {
    lang: typeof req.body?.lang === "string" ? req.body.lang : null,
  });
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
    throw new ValidationError(tReq(req, "app.file.notAttached"));
  }

  const caseDoc = await DiagnosticCase.findOne({
    _id: req.params.id,
    ownerId: req.diagnosticsActor.userId,
  }).lean();
  if (!caseDoc) throw new NotFoundError(tReq(req, "app.case.notFound"));
  if (caseDoc.status === "closed") {
    throw new ValidationError(tReq(req, "app.case.closedReopenToAddMaterials"));
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
  const requestedModality = typeof req.body?.modality === "string" ? req.body.modality : "";
  // Врач нажал «Прочитать снимок», а не «Прикрепить документ».
  //
  // Раньше чтение пикселей включалось только по догадке: либо направление
  // умеет смотреть, либо текста в файле почти нет. На КТ это подводило —
  // маркеры проекции и дата прямо на плёнке дают полсотни символов, файл
  // выглядит как бланк, и снимок остаётся непросмотренным.
  //
  // Догадку оставляем как была: фото бланка по-прежнему не надо разглядывать.
  // Но у врача теперь есть прямой способ сказать, что перед ним снимок, — и
  // он сильнее любой эвристики.
  const forceImageRead =
    req.body?.readImage === "1" ||
    req.body?.readImage === "true" ||
    req.body?.readImage === true;
  // Язык врача для описания снимка. Приходит из formData вместе с файлом:
  // распознавание идёт синхронно, в запросе врача, — в отличие от разбора,
  // который выполняет фоновый воркер и которому язык кладут в задание.
  const lang = normalizeLang(req.body?.lang);

  // ── DICOM: отдельный путь, до распознавания документа ──
  //
  // Текста в срезе нет, зато есть теги, а в тегах — имя пациента, дата
  // рождения и номер карты. Врач их НЕ ВИДИТ и подтверждает обезличивание
  // вслепую, поэтому файл разбирается здесь, до отправки куда-либо, и система
  // сама называет, что в нём лежит. Наружу уходит только отрисованный срез.
  if (looksLikeDicom(req.file.buffer)) {
    let dicom;
    try {
      dicom = await readDicom(req.file.buffer);
    } catch (err) {
      // Сжатый или нестандартный DICOM — отказ с объяснением, а не молчание.
      // Отрисовать «как получится» нельзя: по искажённой картинке сделают вывод.
      return res.status(422).json({
        error: errorText(err, req),
        code: err.compressed ? "DICOM_COMPRESSED" : "DICOM_UNREADABLE",
        // Даже при отказе врач должен узнать, что файл не обезличен.
        phiFields: err.phiFields ?? [],
        fileName: req.file.originalname ?? "",
      });
    }

    const modalityKey =
      requestedModality && supportsImages(requestedModality)
        ? requestedModality
        : dicom.modalityKey;
    const modality = modalityKey ? getModality(modalityKey) : null;

    const study = await readImageStudy({
      buffer: dicom.png,
      mimeType: dicom.mimeType,
      modality,
      hint: [describeDicomStudy(dicom.study), hint].filter(Boolean).join(" "),
      // Многокадровый файл уходит сеткой срезов — модель должна знать об этом
      // из инструкции, а не догадываться по картинке.
      sheet: Boolean(dicom.study.layout),
      lang,
    });

    logger?.info?.(
      {
        caseId: req.params.id,
        // Структурные данные: ни одного значения из тегов.
        dicomModality: dicom.study.modality,
        rows: dicom.study.rows,
        cols: dicom.study.cols,
        phiFieldCount: dicom.phiFields.length,
        observations: study.observations.length,
      },
      "diagnostics dicom read",
    );

    return res.json({
      text: renderImageStudyText(study),
      docKind: "image",
      unreadable: [],
      // Не догадка модели, а точный факт из тегов файла.
      hasPatientIdentity: dicom.phiFields.length > 0,
      phiFields: dicom.phiFields,
      dicom: { ...dicom.study, notes: dicom.notes },
      modality: modalityKey ?? "",
      fileName: req.file.originalname ?? "",
      pages: 1,
      model: study.model,
      promptVersion: study.promptVersion,
    });
  }

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
  const modalityKey = requestedModality;

  // ПРОТОКОЛ ОСМОТРА БЕРЁМ ТОЛЬКО У НАПРАВЛЕНИЯ, КОТОРОЕ УМЕЕТ СМОТРЕТЬ.
  //
  // В форме по умолчанию стоит «Клинический случай», и врач, нажимая
  // «Прочитать снимок», его обычно не трогает — поле выглядит относящимся к
  // кнопке «Добавить в дело». Раньше этот выбор уходил в осмотр как есть, и
  // модель получала указание пройти по чек-листу клинического случая: жалобы
  // и их динамика, анамнез жизни, лекарства и аллергии. Искать это на КТ
  // нечего, и осмотр выходил общим — ровно та жалоба, с которой пришёл врач.
  //
  // Тот же запрет уже стоит в scripts/read-image.mjs: прочитать снимок как
  // «клинический случай» скрипт отказывается. Приложение обходило его через
  // прямое указание врача — расхождение, а не замысел.
  //
  // Без протокола осмотр не разваливается: модель определяет вид исследования
  // по самому изображению (modalityGuess) и идёт общим порядком. Хуже, чем по
  // чек-листу КТ, но несравнимо лучше, чем по чужому.
  const modality = supportsImages(modalityKey) ? getModality(modalityKey) : null;
  let imageStudy = null;

  // Когда читать снимок — решает shouldReadImage (ai/imageStudyReader.js).
  // Оснований три: прямое указание врача, направление, умеющее смотреть, и
  // отсутствие вычитанного текста. Порядок и обоснование — там же.
  if (
    shouldReadImage({
      mimeType: req.file.mimetype,
      forced: forceImageRead,
      modalitySupportsImages: supportsImages(modalityKey),
      extractedText: result.text,
    })
  ) {
    try {
      imageStudy = await readImageStudy({
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
        modality,
        hint,
        lang,
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
