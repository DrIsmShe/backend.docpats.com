// server/modules/radiology/radiology-cases/controllers/case.controller.js

import sharp from "sharp";
import { asyncHandler } from "../../../../common/middlewares/errorHandler.js";
import { ValidationError } from "../../../../common/utils/errors.js";
import { uploadFile } from "../../../../common/middlewares/uploadMiddleware.js";
import { isAuthorRole } from "../../middlewares/radiologyAuth.js";
import { listReadingSystems } from "../../reading-systems/index.js";
import { draftCase, isConfigured as aiConfigured } from "../../ai/aiDrafter.js";
import { generateRadiologyCase } from "../../ai/caseGenerator.js";
import { verifyRadiologyCase } from "../../ai/caseVerifier.js";
import {
  createCase,
  updateCase,
  submitForReview,
  reviewCase,
  archiveCase,
  listCases,
  getCaseFull,
  getCaseForLearner,
} from "../services/case.service.js";
import {
  createCaseSchema,
  updateCaseSchema,
  reviewCaseSchema,
  listCasesQuerySchema,
  aiGenerateCaseSchema,
  aiVerifyCaseSchema,
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

// ИИ-проверка кейса вторым проходом: только замечания, без правок.
export const aiVerifyController = asyncHandler(async (req, res) => {
  const parsed = aiVerifyCaseSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  const review = await verifyRadiologyCase(parsed.data);
  res.json({ review });
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

  const items = await listCases({
    filters: parsed.data,
    isEditor: isAuthorRole(req.radiologyActor.role),
  });
  res.json({ items, count: items.length });
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
  const doc = await getCaseForLearner(req.params.id);
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
