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
import { generateBaselineAnswer } from "../../ai/baselineAnswer.js";
import { saveAiReview, setAiReviewDismissed } from "../../ai/aiReviewStore.js";
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
} from "../services/case.service.js";
import {
  startDailyCaseGeneration,
  stopDailyCaseGeneration,
  getAutogenState,
} from "../../../../jobs/radiologyDailyCases.job.js";
import {
  createCaseSchema,
  updateCaseSchema,
  reviewCaseSchema,
  listCasesQuerySchema,
  aiGenerateCaseSchema,
  aiVerifyCaseSchema,
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
    throw new ValidationError("Нужны imageUrl и modality");
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
  const found = await findCaseImageSources({ topic, modality, hint });
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
  if (!req.file) throw new ValidationError("Файл не передан (поле image)");
  if (!/^image\//.test(req.file.mimetype || "")) {
    throw new ValidationError("Загрузите изображение (PNG, JPEG или WebP)");
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

// Состояние прогона: идёт ли сейчас и чем кончился прошлый.
export const autogenStateController = asyncHandler(async (req, res) => {
  res.json({ ...getAutogenState(), aiEnabled: aiConfigured() });
});
