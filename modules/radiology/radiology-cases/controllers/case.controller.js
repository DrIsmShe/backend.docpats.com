// server/modules/radiology/radiology-cases/controllers/case.controller.js

import sharp from "sharp";
import { asyncHandler } from "../../../../common/middlewares/errorHandler.js";
import { ValidationError, NotFoundError } from "../../../../common/utils/errors.js";
import RadiologyCase from "../models/radiologyCase.model.js";
import { uploadFile } from "../../../../common/middlewares/uploadMiddleware.js";
import { isAuthorRole } from "../../middlewares/radiologyAuth.js";
import { langOf } from "../../translation/requestLang.js";
import { listReadingSystems } from "../../reading-systems/index.js";
import { draftCase, isConfigured as aiConfigured } from "../../ai/aiDrafter.js";
import { generateRadiologyCase } from "../../ai/caseGenerator.js";
import { findCaseImageSources } from "../../ai/imageSourceFinder.js";
import { verifyRadiologyCase } from "../../ai/caseVerifier.js";
import { reviseRadiologyCase } from "../../ai/caseReviser.js";
import { runAutoFix, runTargetedFix } from "../../ai/autoFix.js";
import { startRadiologyCaseAgent } from "../../ai/caseAgent.js";
import { MODEL } from "../../ai/aiRunner.js";
import { generateBaselineAnswer } from "../../ai/baselineAnswer.js";
import { saveAiReview, setAiReviewDismissed } from "../../ai/aiReviewStore.js";
import { tReq } from "../../../../common/i18n/index.js";
import {
  createCase,
  updateCase,
  submitForReview,
  reviewCase,
  archiveCase,
  deleteCasePermanently,
  listCases,
  getCaseFull,
  getCaseForLearner,
  applyRadiologyAiRevision,
} from "../services/case.service.js";
import {
  startDailyCaseGeneration,
  stopDailyCaseGeneration,
  getAutogenFullState,
  setNightlyAutogen,
} from "../../../../jobs/radiologyDailyCases.job.js";
import {
  createCaseSchema,
  updateCaseSchema,
  reviewCaseSchema,
  listCasesQuerySchema,
  aiGenerateCaseSchema,
  aiVerifyCaseSchema,
  aiAutofixCaseSchema,
  aiRunAgentSchema,
  dismissAiIssuesSchema,
} from "../validators/case.schemas.js";

function throwZod(parsed) {
  throw new ValidationError("Validation failed", {
    issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
  });
}

// Готовые системы чтения — конфигурация вьюера/чек-листа для UI. Заодно
// сообщаем, настроен ли ИИ-помощник, чтобы клиент показал/спрятал кнопку.
export const listReadingSystemsController = asyncHandler(async (req, res) => {
  res.json({ systems: listReadingSystems(), aiEnabled: aiConfigured() });
});

// ИИ-черновик кейса по снимку. Только автору. Возвращает заготовку
// (контекст, находки, заключение) — эксперт её проверяет и правит, публикация
// всё равно проходит гейт ревью.
export const aiDraftController = asyncHandler(async (req, res) => {
  const { imageUrl, modality, hint, imageIndex } = req.body ?? {};
  if (!imageUrl || !modality) {
    throw new ValidationError(tReq(req, "app.validation.imageUrlAndModalityRequired"));
  }
  const draft = await draftCase({
    imageUrl,
    modality,
    hint: typeof hint === "string" ? hint.slice(0, 500) : "",
    imageIndex: Number(imageIndex) || 0,
  });
  res.json({ draft });
});

// ИИ-кейс ЦЕЛИКОМ по теме — без снимка. Возвращает контекст, заключение,
// ключи диагноза и ПЛАН находок (что должно быть на снимке и где искать).
// Координаты ИИ здесь не придумывает: снимка ещё нет, а выдуманная точка была
// бы ложным эталоном — находки автор расставляет на холсте сам.
export const aiGenerateController = asyncHandler(async (req, res) => {
  const parsed = aiGenerateCaseSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  const draft = await generateRadiologyCase(parsed.data);
  res.json({ draft });
});

// Поиск снимков под тему кейса.
//
// Закрывает разрыв, на котором работа вставала: ИИ придумывает кейс целиком,
// но нарисовать снимок не может, и автор оставался с готовым текстом без
// единого кадра. Возвращаются ССЫЛКИ на учебные случаи, а не файлы — скачать,
// проверить лицензию и деидентифицировать должен человек.
export const aiFindImagesController = asyncHandler(async (req, res) => {
  const topic = typeof req.body?.topic === "string" ? req.body.topic : "";
  const modality = typeof req.body?.modality === "string" ? req.body.modality : "";
  const hint = typeof req.body?.hint === "string" ? req.body.hint : "";
  const caseId = typeof req.body?.caseId === "string" ? req.body.caseId : null;

  const found = await findCaseImageSources({ topic, modality, hint });

  // Если кейс уже сохранён — кладём находки в него. Поиск стоит денег и
  // времени, а повторять его после каждой перезагрузки страницы владелец не
  // должен: ссылки нужны ровно тогда, когда он вернётся к черновику.
  if (caseId && found.sources.length) {
    await RadiologyCase.findByIdAndUpdate(caseId, {
      imageSources: found.sources,
      imageSearchAdvice: found.advice,
      imageSearchAt: new Date(),
    });
  }

  res.json(found);
});

// ИИ-проверка кейса вторым проходом: только замечания, без правок.
export const aiVerifyController = asyncHandler(async (req, res) => {
  const parsed = aiVerifyCaseSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  const review = await verifyRadiologyCase(parsed.data);
  // Сохранённый кейс получает рецензию внутрь — гейт публикации переживает
  // перезагрузку страницы.
  const stored = await saveAiReview({
    CaseModel: RadiologyCase,
    caseId: parsed.data.caseId,
    review,
  });
  res.json({ review, aiReview: stored });
});

// ТРЕТИЙ ПРОХОД: машина правит кейс по замечаниям и перепроверяет себя.
//
// Правится только ТЕКСТОВАЯ часть — план находок, контекст, заключение.
// Разметку на кадре и галочку деидентификации машина не трогает: точки ставит
// тот, кто снимок видел, и подписывает анонимность тоже он.
//
// Из-за этого у лучевой станции чаще, чем у других, встречается исход «цикл
// остановился, замечание осталось»: если рецензент смотрел на кадр и сказал
// «находки на снимке не видно», текстом это не чинится — редактор отправит
// такое замечание в disputed, и решать будет автор.
export const aiAutofixController = asyncHandler(async (req, res) => {
  const parsed = aiAutofixCaseSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  const { caseId, draft, modality, imageUrl, maxRounds, issues, hint } = parsed.data;

  const revise = (current, list) =>
    reviseRadiologyCase({ draft: current, issues: list, modality, hint });
  // Перепроверка идёт СО СНИМКОМ, если он есть: рецензент должен смотреть на
  // тот же кадр, что и раньше, иначе исправленный текст будет проверен слабее
  // исходного, и цикл «улучшит» кейс, потеряв главную проверку станции.
  const verify = (current) => verifyRadiologyCase({ draft: current, modality, imageUrl });

  const out = issues?.length
    ? await runTargetedFix({ draft, issues, revise, verify })
    : await runAutoFix({ draft, revise, verify, maxRounds: maxRounds ?? 2 });

  if (!caseId) {
    return res.json({ ...out, case: null, markupPresent: false, saved: false });
  }

  // Сначала кейс, потом рецензия: обратный порядок оставил бы чистую рецензию
  // на неисправленной версии.
  const applied = await applyRadiologyAiRevision(caseId, out.draft, {
    rounds: out.rounds.length,
    stoppedBy: out.stoppedBy,
    converged: out.converged,
    changes: out.changes,
    disputed: out.disputed,
    model: MODEL,
    actorId: req.radiologyActor.userId,
  });
  const stored = await saveAiReview({ CaseModel: RadiologyCase, caseId, review: out.review });

  res.json({
    ...out,
    case: applied.case,
    // Находки уже размечены на кадре, а план правился — их мог развести в
    // стороны. Свести обратно может только человек у холста.
    markupPresent: applied.markupPresent,
    aiReview: stored,
    saved: true,
  });
});

// АГЕНТ-ДОВОДЧИК: «снимок загружен — доведи кейс до публикации».
//
// Отличие от /ai/autofix, который рядом: тот правит ЧЕРНОВИК ИЗ ФОРМЫ и
// возвращает результат в форму, оставляя публикацию человеку. Этот работает с
// сохранённым кейсом целиком — правит текст, перепроверяет уже СО СНИМКОМ и
// сам проходит гейт публикации, если после правки блокеров не осталось.
//
// requireReviewer, а не requireAuthor: агент публикует, а публикация — право
// рецензента. Автор без этого права по-прежнему пользуется /ai/autofix.
export const aiRunAgentController = asyncHandler(async (req, res) => {
  const parsed = aiRunAgentSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  // СТАВИМ задачу и отвечаем сразу. Прогон делает до пятнадцати вызовов
  // Opus подряд и в запрос не влезает: nginx рвёт соединение на 240 с, а
  // узел досчитывает и публикует кейс, о котором автору уже сказали
  // «Network Error». Состояние и отчёт автор читает из самого кейса.
  const started = await startRadiologyCaseAgent({
    caseId: req.params.id,
    actorId: req.radiologyActor.userId,
    actorRole: req.radiologyActor.role,
    ...parsed.data,
  });
  res.json(started);
});

// Отметки «разобрано» на замечаниях сохранённой рецензии.
export const dismissIssuesController = asyncHandler(async (req, res) => {
  const parsed = dismissAiIssuesSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  const saved = await setAiReviewDismissed({
    CaseModel: RadiologyCase,
    caseId: req.params.id,
    dismissed: parsed.data.dismissed,
  });
  if (!saved) throw new NotFoundError("Radiology case");
  res.json({ aiReview: saved });
});

// «Типовой ответ чат-бота» на кейс — образец для сигнала дословного переноса
// в заключениях врачей (integrity.service.js). Снимок модели не передаём:
// в реальности врач тоже приносит в чат текстовое описание, а не разметку.
export const aiBaselineController = asyncHandler(async (req, res) => {
  const doc = await RadiologyCase.findById(req.params.id);
  if (!doc) throw new NotFoundError("Radiology case");
  const { text, model } = await generateBaselineAnswer({
    station: "radiology",
    title: doc.title,
    context: doc.clinicalContext ?? "",
  });
  doc.aiBaseline = { text, model, generatedAt: new Date() };
  await doc.save();
  res.json({ aiBaseline: doc.aiBaseline });
});

// Загрузка снимка автором. Переиспользует общий uploadFile: он переэнкодит
// картинку в webp (это ЗАОДНО срезает EXIF — деидентификация метаданных)
// и кладёт в R2 (прод) или в локальную статику (dev). Размеры оригинала
// снимаем до переэнкодинга — они опциональны, нужны для аспект-отношения
// и будущих замеров.
export const uploadImageController = asyncHandler(async (req, res) => {
  if (!req.file) throw new ValidationError(tReq(req, "app.validation.imageFileNotProvided"));
  if (!/^image\//.test(req.file.mimetype || "")) {
    throw new ValidationError(tReq(req, "app.validation.uploadValidImageFormat"));
  }

  let width = null;
  let height = null;
  try {
    const meta = await sharp(req.file.buffer).metadata();
    width = meta.width ?? null;
    height = meta.height ?? null;
  } catch {
    // Размеры опциональны — не срываем загрузку из-за нечитаемых метаданных.
  }

  const url = await uploadFile(req.file);
  res.status(201).json({ url, width, height });
});

export const listCasesController = asyncHandler(async (req, res) => {
  const parsed = listCasesQuerySchema.safeParse(req.query);
  if (!parsed.success) throwZod(parsed);

  // total — сколько всего подходит под фильтр, а не сколько уехало в ответе.
  // Без него интерфейс не отличает «это весь каталог» от «это первая
  // страница», а именно на этом раньше строилась ложная надпись «всего N».
  const isEditor = isAuthorRole(req.radiologyActor.role);
  const page = await listCases({
    filters: parsed.data,
    isEditor,
    // Редактору — исходные названия: он их правит. Врачу — на его языке.
    lang: isEditor ? null : langOf(req),
  });
  res.json({
    items: page.items,
    count: page.items.length,
    total: page.total,
    skip: page.skip,
    limit: page.limit,
    hasMore: page.hasMore,
  });
});

export const createCaseController = asyncHandler(async (req, res) => {
  const parsed = createCaseSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const doc = await createCase(
    parsed.data,
    req.radiologyActor.userId,
    req.radiologyActor.role,
  );
  res.status(201).json({ case: doc });
});

// Редактору — полный кейс (с эталоном), учащемуся — санитизованный.
export const getCaseController = asyncHandler(async (req, res) => {
  if (isAuthorRole(req.radiologyActor.role)) {
    const doc = await getCaseFull(req.params.id);
    return res.json({ case: doc, full: true });
  }
  const doc = await getCaseForLearner(req.params.id, { lang: langOf(req) });
  res.json({ case: doc, full: false });
});

export const updateCaseController = asyncHandler(async (req, res) => {
  const parsed = updateCaseSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  const doc = await updateCase(req.params.id, parsed.data, req.radiologyActor.userId);
  res.json({ case: doc });
});

export const submitCaseController = asyncHandler(async (req, res) => {
  const doc = await submitForReview(
    req.params.id,
    req.radiologyActor.userId,
    req.radiologyActor.role,
  );
  res.json({ case: doc });
});

export const reviewCaseController = asyncHandler(async (req, res) => {
  const parsed = reviewCaseSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  const doc = await reviewCase(
    req.params.id,
    parsed.data,
    req.radiologyActor.userId,
    req.radiologyActor.role,
  );
  res.json({ case: doc });
});

export const archiveCaseController = asyncHandler(async (req, res) => {
  const doc = await archiveCase(
    req.params.id,
    req.radiologyActor.userId,
    req.radiologyActor.role,
  );
  res.json({ case: doc });
});

// Удаление НАСОВСЕМ — отдельный маршрут, а не флаг у архивации: разные
// последствия должны требовать разного запроса, иначе однажды один лишний
// параметр сотрёт то, что собирались спрятать. Ограничения — в сервисе.
export const deleteCaseController = asyncHandler(async (req, res) => {
  const out = await deleteCasePermanently(
    req.params.id,
    req.radiologyActor.userId,
    req.radiologyActor.role,
  );
  res.json(out);
});

// Ручной запуск ночной автогенерации — та же работа, что делает cron, но
// сейчас и по кнопке владельца. Отвечаем СРАЗУ (202), не дожидаясь конца:
// пять запросов к модели идут минуты, а соединение до админки столько не
// живёт. За результатом клиент возвращается на /autogen/state.
export const runAutogenController = asyncHandler(async (req, res) => {
  // Раздел выбирает владелец: снимки, анализы, виртуальный пациент или всё
  // сразу. Неизвестное значение молча превращается в «всё» — прежнее
  // поведение, чтобы старый клиент продолжал работать.
  const scope = typeof req.body?.scope === "string" ? req.body.scope : "all";
  const state = startDailyCaseGeneration({ scope });
  res.status(202).json({ ...state, aiEnabled: aiConfigured() });
});

// Остановка прогона. Прервётся на границе пунктов плана — начатый кейс
// доделается, см. stopDailyCaseGeneration.
export const stopAutogenController = asyncHandler(async (req, res) => {
  const state = stopDailyCaseGeneration();
  res.json({ ...state, aiEnabled: aiConfigured() });
});

// Состояние: идёт ли прогон, чем кончился прошлый и включена ли ночная
// генерация.
export const autogenStateController = asyncHandler(async (req, res) => {
  const state = await getAutogenFullState();
  res.json({ ...state, aiEnabled: aiConfigured() });
});

// Включить/выключить НОЧНУЮ генерацию. Идущий прогон это не трогает — для
// него есть отдельная кнопка остановки.
export const autogenToggleController = asyncHandler(async (req, res) => {
  const enabled = req.body?.enabled !== false && req.body?.enabled !== "false";
  const state = await setNightlyAutogen(enabled, req.radiologyActor?.userId ?? null);
  res.json({ ...state, aiEnabled: aiConfigured() });
});
