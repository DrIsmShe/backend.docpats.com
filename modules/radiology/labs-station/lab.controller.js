// server/modules/radiology/labs-station/lab.controller.js

import { asyncHandler } from "../../../common/middlewares/errorHandler.js";
import { ValidationError } from "../../../common/utils/errors.js";
import { isAuthorRole } from "../middlewares/radiologyAuth.js";
import {
  createLabCase,
  updateLabCase,
  setLabStatus,
  deleteLabCasePermanently,
  applyLabAiRevision,
  listLabCases,
  getLabCaseFull,
  sanitizeLabForLearner,
  startLabAttempt,
  submitLabAttempt,
  getLabAttempt,
  getLabPolicy,
} from "./lab.service.js";
import LabCase from "./models/labCase.model.js";
import { generateLabCase } from "../ai/caseGenerator.js";
import { verifyLabCase } from "../ai/caseVerifier.js";
import { reviseLabCase } from "../ai/caseReviser.js";
import { runAutoFix, runTargetedFix } from "../ai/autoFix.js";
import { runLabCaseAgent } from "../ai/caseAgent.js";
import { MODEL } from "../ai/aiRunner.js";
import { generateBaselineAnswer } from "../ai/baselineAnswer.js";
import { generateLabVariants } from "../ai/caseVariants.js";
import { saveAiReview, setAiReviewDismissed } from "../ai/aiReviewStore.js";
import {
  createLabSchema,
  updateLabSchema,
  statusLabSchema,
  submitLabSchema,
  listLabQuerySchema,
  aiGenerateLabSchema,
  aiVerifyLabSchema,
  aiAutofixLabSchema,
  aiRunAgentLabSchema,
  dismissAiIssuesSchema,
  aiVariantsSchema,
  startLabSchema,
  labPolicyQuerySchema,
} from "./lab.schemas.js";
import { NotFoundError } from "../../../common/utils/errors.js";

// Язык врача — общий разбор заголовков на все три станции
// (translation/requestLang.js).
import { langOf } from "../translation/requestLang.js";
import { translatedCaseFor } from "../translation/translatedCase.js";


function throwZod(parsed) {
  throw new ValidationError("Validation failed", {
    issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
  });
}

export const listLabCasesController = asyncHandler(async (req, res) => {
  const parsed = listLabQuerySchema.safeParse(req.query);
  if (!parsed.success) throwZod(parsed);
  const isEditor = isAuthorRole(req.radiologyActor.role);
  const page = await listLabCases({
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

// ИИ-генерация кейса ЦЕЛИКОМ по теме. Только автору. Ничего не сохраняет:
// возвращает заготовку, которой клиент заполняет форму, — эксперт проверяет
// значения и сам решает, сохранять и публиковать ли.
export const aiGenerateLabCaseController = asyncHandler(async (req, res) => {
  const parsed = aiGenerateLabSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  const draft = await generateLabCase(parsed.data);
  res.json({ draft });
});

// ИИ-проверка кейса вторым проходом. Возвращает ЗАМЕЧАНИЯ, ничего не правит
// и не сохраняет: решение за автором-человеком.
export const aiVerifyLabCaseController = asyncHandler(async (req, res) => {
  const parsed = aiVerifyLabSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  const review = await verifyLabCase(parsed.data);
  // Кейс сохранён — прячем рецензию в него: гейт публикации должен переживать
  // перезагрузку страницы. Сохраняется то, что посчитал сервер, а не то, что
  // прислал браузер.
  const stored = await saveAiReview({
    CaseModel: LabCase,
    caseId: parsed.data.caseId,
    review,
  });
  res.json({ review, aiReview: stored });
});

// ТРЕТИЙ ПРОХОД: машина сама правит кейс по замечаниям и перепроверяет себя,
// пока рецензия не станет чистой (ai/autoFix.js). Гейт публикации при этом не
// обходится — он считает неразобранные замечания, а после чистой рецензии
// считать нечего.
//
// Стартовую рецензию считаем ЗАНОВО, а не берём сохранённую: сохранённая
// относится к сохранённому кейсу, а править надо то, что сейчас в форме.
// Лишний вызов модели дешевле, чем правки по замечаниям к другой версии.
// АГЕНТ-ДОВОДЧИК: «доделай и опубликуй».
//
// Отличие от /ai/autofix, который рядом: тот правит ЧЕРНОВИК ИЗ ФОРМЫ и
// возвращает результат в форму, оставляя публикацию человеку. Этот работает с
// сохранённым кейсом целиком — правит текст, перепроверяет себя и сам проходит
// гейт публикации, если после правки блокеров не осталось.
//
// Права те же, что у ручной смены статуса на этой станции (requireAuthor):
// агент публикует ровно то, что автор и так вправе опубликовать кнопкой.
export const aiRunAgentLabController = asyncHandler(async (req, res) => {
  const parsed = aiRunAgentLabSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  const report = await runLabCaseAgent({
    caseId: req.params.id,
    actorId: req.radiologyActor.userId,
    actorRole: req.radiologyActor.role,
    ...parsed.data,
  });
  res.json(report);
});

export const aiAutofixLabCaseController = asyncHandler(async (req, res) => {
  const parsed = aiAutofixLabSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  const { caseId, draft, maxRounds, issues, hint } = parsed.data;

  const revise = (current, list) => reviseLabCase({ draft: current, issues: list, hint });
  const verify = (current) => verifyLabCase({ draft: current });

  // Автор указал, ЧТО править (кнопка «исправить» у замечания) — один круг
  // ровно по этому списку. Иначе полный проход: сервер сам рецензирует кейс и
  // доводит его, пока замечания не кончатся.
  const out = issues?.length
    ? await runTargetedFix({ draft, issues, revise, verify })
    : await runAutoFix({
        draft,
        revise,
        verify,
        // По умолчанию два круга, а не три, как у ночного прогона: здесь ответа
        // ждёт открытый браузер через nginx, и каждый круг — два вызова Opus с
        // рассуждением. Третий круг доступен явным maxRounds, если автор готов
        // ждать.
        maxRounds: maxRounds ?? 2,
      });

  // Несохранённый кейс (автор ещё не нажимал «Сохранить») просто возвращаем в
  // форму: записывать нечего, и рецензию прятать некуда.
  if (!caseId) {
    return res.json({ ...out, case: null, variantsStale: false, saved: false });
  }

  // Порядок важен: сначала кейс, потом рецензия. Обратный порядок оставил бы
  // чистую рецензию на неисправленном кейсе — то есть открыл бы гейт тому,
  // чего рецензент не видел.
  const applied = await applyLabAiRevision(caseId, out.draft, {
    rounds: out.rounds.length,
    stoppedBy: out.stoppedBy,
    converged: out.converged,
    changes: out.changes,
    disputed: out.disputed,
    model: MODEL,
    actorId: req.radiologyActor.userId,
  });
  const stored = await saveAiReview({ CaseModel: LabCase, caseId, review: out.review });

  res.json({
    ...out,
    case: applied.case,
    variantsStale: applied.variantsStale,
    aiReview: stored,
    saved: true,
  });
});

export const createLabCaseController = asyncHandler(async (req, res) => {
  const parsed = createLabSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  const doc = await createLabCase(parsed.data, req.radiologyActor.userId, req.radiologyActor.role);
  res.status(201).json({ case: doc });
});

export const getLabCaseController = asyncHandler(async (req, res) => {
  if (isAuthorRole(req.radiologyActor.role)) {
    return res.json({ case: await getLabCaseFull(req.params.id), full: true });
  }
  const doc = await LabCase.findById(req.params.id).lean();
  if (!doc || doc.status !== "published") throw new NotFoundError("Lab case");
  // Кейс на языке врача; недостающий перевод догоняется здесь по требованию.
  const localized = await translatedCaseFor("labs", doc, langOf(req), { lazy: true });
  res.json({ case: sanitizeLabForLearner(localized), full: false });
});

export const updateLabCaseController = asyncHandler(async (req, res) => {
  const parsed = updateLabSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  res.json({ case: await updateLabCase(req.params.id, parsed.data) });
});

export const statusLabCaseController = asyncHandler(async (req, res) => {
  const parsed = statusLabSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  const doc = await setLabStatus(
    req.params.id,
    parsed.data.status,
    req.radiologyActor.userId,
    req.radiologyActor.role,
  );
  res.json({ case: doc });
});

// Удаление НАСОВСЕМ — отдельный маршрут, а не статус: архив прячет кейс, это
// стирает его вместе с переводами. Ограничения — в сервисе.
export const deleteLabCaseController = asyncHandler(async (req, res) => {
  const out = await deleteLabCasePermanently(
    req.params.id,
    req.radiologyActor.userId,
    req.radiologyActor.role,
  );
  res.json(out);
});

// Отметки «разобрано» на замечаниях сохранённой рецензии. Пока замечание не
// разобрано, кейс не публикуется — и это состояние переживает перезагрузку
// страницы, потому что живёт в кейсе, а не в браузере.
export const dismissLabIssuesController = asyncHandler(async (req, res) => {
  const parsed = dismissAiIssuesSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  const saved = await setAiReviewDismissed({
    CaseModel: LabCase,
    caseId: req.params.id,
    dismissed: parsed.data.dismissed,
  });
  if (!saved) throw new NotFoundError("Lab case");
  res.json({ aiReview: saved });
});

// ИИ-варианты кейса: тот же диагноз, другие значения. Сохраняются сразу —
// автор дальше правит их как обычные данные кейса или удаляет.
export const aiVariantsLabController = asyncHandler(async (req, res) => {
  const parsed = aiVariantsSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  const doc = await LabCase.findById(req.params.id);
  if (!doc) throw new NotFoundError("Lab case");
  const variants = await generateLabVariants(doc, parsed.data.count ?? 2);
  if (!variants.length) {
    throw new ValidationError(
      "ИИ не вернул ни одного пригодного варианта — попробуйте ещё раз",
    );
  }
  doc.variants = variants;
  await doc.save();
  res.json({ variants: doc.variants });
});

// Сохранить «типовой ответ чат-бота» на кейс. Нужен как образец для сравнения
// с заключениями врачей: дословное совпадение длинными цепочками видно в
// сигналах добросовестности. На оценку не влияет.
export const aiBaselineLabController = asyncHandler(async (req, res) => {
  const doc = await LabCase.findById(req.params.id);
  if (!doc) throw new NotFoundError("Lab case");
  const { text, model } = await generateBaselineAnswer({
    station: "labs",
    title: doc.title,
    context: doc.clinicalContext ?? "",
    data: (doc.panel ?? []).map(
      (p) => `${p.name}: ${p.value}${p.unit ? " " + p.unit : ""}${p.refRange ? ` (норма ${p.refRange})` : ""}`,
    ),
  });
  doc.aiBaseline = { text, model, generatedAt: new Date() };
  await doc.save();
  res.json({ aiBaseline: doc.aiBaseline });
});

// Условия попытки ДО старта: зачёт или тренировка, лимит времени, когда
// откроется следующая зачётная попытка по этому кейсу.
export const labPolicyController = asyncHandler(async (req, res) => {
  const parsed = labPolicyQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) throwZod(parsed);
  res.json({
    policy: await getLabPolicy(
      req.params.id,
      req.radiologyActor.userId,
      parsed.data.mode ?? "learn",
    ),
  });
});

export const startLabAttemptController = asyncHandler(async (req, res) => {
  const parsed = startLabSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  res
    .status(201)
    .json(
      await startLabAttempt(
        req.params.id,
        req.radiologyActor.userId,
        parsed.data.mode ?? "learn",
        langOf(req),
      ),
    );
});

export const submitLabAttemptController = asyncHandler(async (req, res) => {
  const parsed = submitLabSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  res.json(await submitLabAttempt(req.params.id, req.radiologyActor.userId, parsed.data));
});

export const getLabAttemptController = asyncHandler(async (req, res) => {
  res.json(await getLabAttempt(req.params.id, req.radiologyActor.userId));
});
