// server/modules/radiology/virtual-patient/vp.controller.js

import { asyncHandler } from "../../../common/middlewares/errorHandler.js";
import { ValidationError, NotFoundError } from "../../../common/utils/errors.js";
import { isAuthorRole } from "../middlewares/radiologyAuth.js";
import VirtualPatientCase from "./models/vpCase.model.js";
import {
  createVpCase,
  updateVpCase,
  setVpStatus,
  deleteVpCasePermanently,
  listVpCases,
  getVpCaseFull,
  sanitizeVpForLearner,
  startVpAttempt,
  orderInvestigation,
  submitVpAttempt,
  getVpAttempt,
  getVpPolicy,
  commitDifferential,
  applyVpAiRevision,
} from "./vp.service.js";
import { generateVpCase } from "../ai/caseGenerator.js";
import { verifyVpCase } from "../ai/caseVerifier.js";
import { reviseVpCase } from "../ai/caseReviser.js";
import { runAutoFix } from "../ai/autoFix.js";
import { MODEL } from "../ai/aiRunner.js";
import { generateBaselineAnswer } from "../ai/baselineAnswer.js";
import { generateVpVariants } from "../ai/caseVariants.js";
import { saveAiReview, setAiReviewDismissed } from "../ai/aiReviewStore.js";
import {

  createVpSchema,
  updateVpSchema,
  statusVpSchema,
  orderVpSchema,
  submitVpSchema,
  listVpQuerySchema,
  aiGenerateVpSchema,
  aiVerifyVpSchema,
  aiAutofixVpSchema,
  dismissAiIssuesSchema,
  aiVariantsSchema,
  startVpSchema,
  vpPolicyQuerySchema,
  commitVpSchema,
} from "./vp.schemas.js";

function throwZod(parsed) {
  throw new ValidationError("Validation failed", {
    issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
  });
}


// Язык врача — общий разбор заголовков на все три станции
// (translation/requestLang.js).
import { langOf } from "../translation/requestLang.js";
import { translatedCaseFor } from "../translation/translatedCase.js";

export const listVpController = asyncHandler(async (req, res) => {
  const parsed = listVpQuerySchema.safeParse(req.query);
  if (!parsed.success) throwZod(parsed);
  const isEditor = isAuthorRole(req.radiologyActor.role);
  const page = await listVpCases({
    isEditor,
    // Редактору — исходные названия: он их правит. Врачу — на его языке.
    lang: isEditor ? null : langOf(req),
    ...parsed.data,
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

// ИИ-генерация сценария ЦЕЛИКОМ по теме. Только автору. Ничего не сохраняет:
// возвращает заготовку для формы — автор проверяет и сохраняет сам.
export const aiGenerateVpController = asyncHandler(async (req, res) => {
  const parsed = aiGenerateVpSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  const draft = await generateVpCase(parsed.data);
  res.json({ draft });
});

// ИИ-проверка сценария вторым проходом: только замечания, без правок.
export const aiVerifyVpController = asyncHandler(async (req, res) => {
  const parsed = aiVerifyVpSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  const review = await verifyVpCase(parsed.data);
  // Сохранённый кейс получает рецензию внутрь — гейт публикации переживает
  // перезагрузку страницы.
  const stored = await saveAiReview({
    CaseModel: VirtualPatientCase,
    caseId: parsed.data.caseId,
    review,
  });
  res.json({ review, aiReview: stored });
});

// ТРЕТИЙ ПРОХОД: машина правит сценарий по замечаниям и перепроверяет себя,
// пока рецензия не станет чистой (ai/autoFix.js). Гейт публикации не
// обходится: он считает неразобранные замечания, а после чистой рецензии
// считать нечего. Подробности — в одноимённом контроллере станции «Анализы».
export const aiAutofixVpController = asyncHandler(async (req, res) => {
  const parsed = aiAutofixVpSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  const { caseId, draft, maxRounds } = parsed.data;

  const out = await runAutoFix({
    draft,
    revise: (current, issues) => reviseVpCase({ draft: current, issues }),
    verify: (current) => verifyVpCase({ draft: current }),
    // Два круга, а не три: ответа ждёт браузер через nginx, а круг — это два
    // вызова Opus с рассуждением.
    maxRounds: maxRounds ?? 2,
  });

  if (!caseId) {
    return res.json({ ...out, case: null, variantsStale: false, saved: false });
  }

  // Сначала сценарий, потом рецензия: обратный порядок оставил бы чистую
  // рецензию на неисправленных данных.
  const applied = await applyVpAiRevision(caseId, out.draft, {
    rounds: out.rounds.length,
    stoppedBy: out.stoppedBy,
    converged: out.converged,
    changes: out.changes,
    disputed: out.disputed,
    model: MODEL,
    actorId: req.radiologyActor.userId,
  });
  const stored = await saveAiReview({
    CaseModel: VirtualPatientCase,
    caseId,
    review: out.review,
  });

  res.json({
    ...out,
    case: applied.case,
    variantsStale: applied.variantsStale,
    aiReview: stored,
    saved: true,
  });
});

// Отметки «разобрано» на замечаниях сохранённой рецензии.
export const dismissVpIssuesController = asyncHandler(async (req, res) => {
  const parsed = dismissAiIssuesSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  const saved = await setAiReviewDismissed({
    CaseModel: VirtualPatientCase,
    caseId: req.params.id,
    dismissed: parsed.data.dismissed,
  });
  if (!saved) throw new NotFoundError("VP case");
  res.json({ aiReview: saved });
});

export const createVpController = asyncHandler(async (req, res) => {
  const parsed = createVpSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  const doc = await createVpCase(parsed.data, req.radiologyActor.userId, req.radiologyActor.role);
  res.status(201).json({ case: doc });
});

export const getVpController = asyncHandler(async (req, res) => {
  if (isAuthorRole(req.radiologyActor.role)) {
    return res.json({ case: await getVpCaseFull(req.params.id), full: true });
  }
  const doc = await VirtualPatientCase.findById(req.params.id).lean();
  if (!doc || doc.status !== "published") throw new NotFoundError("VP case");
  // Сценарий на языке врача; недостающий перевод догоняется по требованию.
  const localized = await translatedCaseFor("vp", doc, langOf(req), { lazy: true });
  res.json({ case: sanitizeVpForLearner(localized), full: false });
});

export const updateVpController = asyncHandler(async (req, res) => {
  const parsed = updateVpSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  res.json({ case: await updateVpCase(req.params.id, parsed.data) });
});

export const statusVpController = asyncHandler(async (req, res) => {
  const parsed = statusVpSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  const doc = await setVpStatus(req.params.id, parsed.data.status, req.radiologyActor.userId, req.radiologyActor.role);
  res.json({ case: doc });
});

// Удаление НАСОВСЕМ — отдельный маршрут, а не статус: архив прячет сценарий,
// это стирает его вместе с переводами. Ограничения — в сервисе.
export const deleteVpCaseController = asyncHandler(async (req, res) => {
  const out = await deleteVpCasePermanently(
    req.params.id,
    req.radiologyActor.userId,
    req.radiologyActor.role,
  );
  res.json(out);
});

// ИИ-варианты сценария: тот же диагноз, другой пациент и другие числовые
// результаты. Список нужных обследований не меняется.
export const aiVariantsVpController = asyncHandler(async (req, res) => {
  const parsed = aiVariantsSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  const doc = await VirtualPatientCase.findById(req.params.id);
  if (!doc) throw new NotFoundError("VP case");
  const variants = await generateVpVariants(doc, parsed.data.count ?? 2);
  if (!variants.length) {
    throw new ValidationError(
      "ИИ не вернул ни одного пригодного варианта — попробуйте ещё раз",
    );
  }
  doc.variants = variants;
  await doc.save();
  res.json({ variants: doc.variants });
});

// «Типовой ответ чат-бота» на сценарий — образец для сигнала дословного
// переноса. В промпт уходит только то, что видит учащийся в начале: жалоба и
// анамнез. Результаты обследований не передаём — их врач раскрывает по одному,
// и чат-бот в реальности их тоже не увидит.
export const aiBaselineVpController = asyncHandler(async (req, res) => {
  const doc = await VirtualPatientCase.findById(req.params.id);
  if (!doc) throw new NotFoundError("VP case");
  const { text, model } = await generateBaselineAnswer({
    station: "vp",
    title: doc.title,
    context: doc.presentation ?? "",
  });
  doc.aiBaseline = { text, model, generatedAt: new Date() };
  await doc.save();
  res.json({ aiBaseline: doc.aiBaseline });
});

// Условия попытки ДО старта: зачёт или тренировка, лимит времени, когда
// откроется следующая зачётная. Страница печатает это врачу до первого клика.
export const vpPolicyController = asyncHandler(async (req, res) => {
  const parsed = vpPolicyQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) throwZod(parsed);
  res.json({
    policy: await getVpPolicy(req.params.id, req.radiologyActor.userId, parsed.data.mode ?? "learn"),
  });
});

export const startVpController = asyncHandler(async (req, res) => {
  const parsed = startVpSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  res
    .status(201)
    .json(
      await startVpAttempt(
        req.params.id,
        req.radiologyActor.userId,
        parsed.data.mode ?? "learn",
        langOf(req),
      ),
    );
});

// Предварительная фиксация дифдиагноза. Ответ без обратной связи: сказать
// «угадал» здесь означало бы выдать ответ до конца сценария.
export const commitVpController = asyncHandler(async (req, res) => {
  const parsed = commitVpSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  res.json({
    commitment: await commitDifferential(
      req.params.id,
      req.radiologyActor.userId,
      parsed.data.text,
    ),
  });
});

export const orderVpController = asyncHandler(async (req, res) => {
  const parsed = orderVpSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  const result = await orderInvestigation(req.params.id, req.radiologyActor.userId, parsed.data.key);
  res.json({ investigation: result });
});

export const submitVpController = asyncHandler(async (req, res) => {
  const parsed = submitVpSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  res.json(await submitVpAttempt(req.params.id, req.radiologyActor.userId, parsed.data));
});

export const getVpAttemptController = asyncHandler(async (req, res) => {
  res.json(await getVpAttempt(req.params.id, req.radiologyActor.userId));
});
