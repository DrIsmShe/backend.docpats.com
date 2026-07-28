// server/modules/radiology/virtual-patient/vp.service.js
//
// Режим «Виртуальный пациент»: жалоба → заказ обследований → диагноз.
// Переиспользует движки арены (combineTotal, gradeImpression, awardForAttempt).
//
// Результаты обследований НЕ уходят учащемуся заранее: он «назначает»
// обследование отдельным запросом (orderInvestigation), и только тогда
// сервер раскрывает результат И фиксирует назначение. Так оценка разумного
// набора (не заказал лишнего) остаётся авторитетной, а не декоративной.

import VirtualPatientCase from "./models/vpCase.model.js";
import VirtualPatientAttempt from "./models/vpAttempt.model.js";
import { combineTotal } from "../radiology-attempts/services/scoring.service.js";
import { gradeImpression } from "../radiology-attempts/services/impressionGrader.js";
import { awardForAttempt } from "../game/game.service.js";
import { gradeDiagnosis } from "../radiology-attempts/services/diagnosisMatcher.js";
import { translatedCaseFor } from "../translation/translatedCase.js";
import { paginate, titleFilter } from "../catalog.js";
import {
  previewPolicy,
  resolveAttemptStart,
  isExpired,
  secondsLeft,
} from "../radiology-attempts/services/attemptPolicy.js";
import { assessIntegrity } from "../radiology-attempts/services/integrity.service.js";
import { recordCaseStats } from "../radiology-attempts/services/caseStats.service.js";
import { updateReviewItem } from "../review/review.service.js";
import {
  pickVariantIndex,
  applyVpVariant,
} from "../radiology-attempts/services/variantPicker.js";
import { unresolvedAiIssues } from "../ai/aiReviewFields.js";
import { recordRadiologyEvent } from "../audit/audit.service.js";
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from "../../../common/utils/errors.js";

// Веса компонентов. Смещены в сторону того, что нельзя переслать в чужую
// модель: путь обследования (заказы по одному, с фиксацией) и предварительный
// дифдиагноз, названный ДО раскрытия результатов. Свободный текст обоснования
// — самая пересылаемая часть, поэтому его вес самый маленький.
import { scheduleCaseTranslation } from "../translation/onPublish.js";

const WEIGHTS = { diagnosis: 0.35, workup: 0.3, prior: 0.2, reasoning: 0.15 };
const PASS = 0.7;

/** Сколько диагнозов перечислено в предварительной версии. */
function countItems(text) {
  return String(text ?? "")
    .split(/[,;\n]+|\bили\b/gi)
    .map((s) => s.trim())
    .filter((s) => s.length > 1).length;
}

/**
 * Предварительный дифдиагноз: попал ли верный ответ в ряд, названный до
 * результатов обследований. Это самый честный из доступных нам сигналов
 * собственного знания: по одной жалобе чужая модель почти не помогает.
 *
 * Список из десятка диагнозов «на всякий случай» — не знание, а перебор,
 * поэтому за размашистый ряд ставится половина.
 */
function scorePrior(caseDoc, commitment) {
  if (!commitment?.committedAt) return { prior: null, hit: false, matched: "" };
  const { score, matched } = gradeDiagnosis({
    givenText: commitment.text,
    acceptedKeys: caseDoc.diagnosis?.diagnosisKeys,
    synonyms: caseDoc.diagnosis?.diagnosisSynonyms,
  });
  if (score !== 1) return { prior: 0, hit: false, matched: "" };
  const items = countItems(commitment.text);
  return { prior: items > 5 ? 0.5 : 1, hit: true, matched: matched ?? "" };
}

// ─── Скоринг ──────────────────────────────────────────────────────────
function scoreVp(caseDoc, response) {
  const invKeys = new Set(caseDoc.investigations.map((i) => i.key));
  const necessary = new Set(
    caseDoc.investigations.filter((i) => i.necessary).map((i) => i.key),
  );
  const ordered = new Set((response.ordered ?? []).filter((k) => invKeys.has(k)));

  let workup;
  const overKeys = [...ordered].filter((k) => !necessary.has(k));
  if (necessary.size === 0) {
    workup = null;
  } else {
    const covered = [...necessary].filter((k) => ordered.has(k)).length / necessary.size;
    // Каждое лишнее обследование — минус 10% (гипердиагностика штрафуется).
    workup = Math.max(0, Math.min(1, covered - 0.1 * overKeys.length));
  }

  // Диагноз: точное совпадение ключа ИЛИ вхождение ключа/синонима в
  // развёрнутую формулировку — см. diagnosisMatcher.
  const { score: diagnosis } = gradeDiagnosis({
    givenKeys: response.diagnosisKeys,
    givenText: response.diagnosisText,
    acceptedKeys: caseDoc.diagnosis?.diagnosisKeys,
    synonyms: caseDoc.diagnosis?.diagnosisSynonyms,
  });

  const nameByKey = new Map(caseDoc.investigations.map((i) => [i.key, i.name]));
  return {
    workup,
    diagnosis,
    overordered: overKeys.length,
    workupDetail: {
      missedNecessary: [...necessary]
        .filter((k) => !ordered.has(k))
        .map((k) => nameByKey.get(k) ?? k),
      overordered: overKeys.map((k) => nameByKey.get(k) ?? k),
      orderedCount: ordered.size,
    },
  };
}

export function collectVpBlockers(doc) {
  const b = [];
  if ((doc.investigations?.length ?? 0) < 2) b.push("добавьте минимум 2 обследования");
  if (!doc.investigations?.some((i) => i.necessary))
    b.push("отметьте хотя бы одно нужное обследование");
  if (!(doc.diagnosis?.diagnosisKeys?.length ?? 0)) b.push("укажите верный диагноз");
  if (["public_government", "licensed"].includes(doc.source?.kind) && !doc.source?.authority)
    b.push("для заимствованного материала не указан орган/издание");
  // Неразобранные замечания ИИ-рецензента. Блокируют ВСЕ, а не только
  // severity=error: калибровка показала, что модель систематически занижает
  // серьёзность, и промптом это не лечится. «Разобрано» ставит человек —
  // гейт требует не согласия с ИИ, а того, чтобы замечание прочитали.
  const openIssues = unresolvedAiIssues(doc.aiReview).length;
  if (openIssues)
    b.push(`разберите замечания ИИ-рецензента (${openIssues})`);
  return b;
}

// ─── CRUD ─────────────────────────────────────────────────────────────
export async function createVpCase(input, actorId, actorRole) {
  const doc = await VirtualPatientCase.create({
    title: input.title,
    presentation: input.presentation ?? "",
    difficulty: input.difficulty ?? "medium",
    categoryId: input.categoryId ?? null,
    investigations: input.investigations ?? [],
    variants: input.variants ?? [],
    diagnosis: input.diagnosis ?? {},
    source: input.source,
    status: "draft",
    createdBy: actorId,
  });
  recordRadiologyEvent({ action: "vp.create", actorId, actorRole, metadata: { inv: doc.investigations.length } });
  return doc.toObject();
}

export async function updateVpCase(caseId, patch) {
  const doc = await VirtualPatientCase.findById(caseId);
  if (!doc) throw new NotFoundError("VP case");
  if (doc.status === "archived") throw new ConflictError("Архивный кейс редактировать нельзя");
  const FIELDS = ["title", "presentation", "difficulty", "categoryId", "investigations", "variants", "diagnosis", "source"];
  for (const f of FIELDS) if (patch[f] !== undefined) doc[f] = patch[f];
  await doc.save();
  return doc.toObject();
}

export async function setVpStatus(caseId, status, actorId, actorRole) {
  const doc = await VirtualPatientCase.findById(caseId);
  if (!doc) throw new NotFoundError("VP case");
  if (status === "published") {
    const blockers = collectVpBlockers(doc);
    if (blockers.length) {
      throw new ValidationError(`Опубликовать нельзя: ${blockers.join("; ")}`, { blockers });
    }
    doc.status = "published";
    doc.publishedAt = doc.publishedAt ?? new Date();
    // Перевод на остальные языки — после публикации и не в этом запросе.
    scheduleCaseTranslation("vp", doc._id, { actorId });
  } else if (status === "draft" || status === "archived") {
    doc.status = status;
  } else {
    throw new ValidationError("Неизвестный статус");
  }
  await doc.save();
  recordRadiologyEvent({ action: `vp.${status}`, actorId, actorRole, metadata: {} });
  return doc.toObject();
}

export async function listVpCases({ isEditor, scope, status, difficulty, q, skip, limit }) {
  const query = {};
  if (isEditor && scope === "all") {
    if (status) query.status = status;
  } else {
    query.status = "published";
  }
  if (difficulty) query.difficulty = difficulty;

  const byTitle = titleFilter(q);
  if (byTitle) Object.assign(query, byTitle);

  return paginate(VirtualPatientCase, {
    query,
    // Белый список полей, а не исключение: variants и diagnosis наружу
    // отдавать нельзя (внутри варианта лежат тексты результатов обследований,
    // то есть половина ответа), и при добавлении нового поля в модель
    // безопаснее забыть включить его, чем забыть исключить.
    select: "_id title difficulty status createdAt",
    skip,
    limit,
  });
}

export async function getVpCaseFull(caseId) {
  const doc = await VirtualPatientCase.findById(caseId).lean();
  if (!doc) throw new NotFoundError("VP case");
  return { ...doc, publishBlockers: collectVpBlockers(doc) };
}

// Учащемуся: жалоба + МЕНЮ обследований без результатов и без пометки
// «нужное» — результат раскрывается только при заказе.
/**
 * Сценарий для учащегося. variantIndex — какой вариант ему достался (0 —
 * базовый). Вариант меняет жалобу и числовые результаты, но НЕ список
 * обследований: врач должен приходить к тому же набору назначений.
 */
export function sanitizeVpForLearner(doc, variantIndex = 0) {
  const { presentation, variantLabel } = applyVpVariant(doc, variantIndex);
  return {
    _id: doc._id,
    title: doc.title,
    presentation,
    difficulty: doc.difficulty,
    variantLabel,
    variantCount: doc.variants?.length ?? 0,
    investigations: (doc.investigations ?? []).map((i) => ({
      key: i.key,
      name: i.name,
      category: i.category,
    })),
  };
}

// ─── Прохождение ──────────────────────────────────────────────────────
/** Условия попытки до старта: зачёт или тренировка, лимит, когда следующий зачёт. */
export async function getVpPolicy(caseId, userId, mode = "learn") {
  const caseDoc = await VirtualPatientCase.findById(caseId).select("status timeLimitSec").lean();
  if (!caseDoc || caseDoc.status !== "published") throw new NotFoundError("VP case");
  return previewPolicy({
    AttemptModel: VirtualPatientAttempt,
    station: "vp",
    caseId,
    userId,
    mode,
    caseTimeLimitSec: caseDoc.timeLimitSec ?? null,
    scoring: { weights: WEIGHTS, passThreshold: PASS },
  });
}

export async function startVpAttempt(caseId, userId, mode = "learn", lang = "ru") {
  const source = await VirtualPatientCase.findById(caseId).lean();
  if (!source || source.status !== "published") throw new NotFoundError("VP case");
  const caseDoc = await translatedCaseFor("vp", source, lang);

  // Незакрытую попытку продолжаем — вместе с уже раскрытыми обследованиями и
  // зафиксированным дифрядом. Просроченную помечаем, но не удаляем: по ней
  // считается слот «зачёт раз в 24 часа».
  const open = await VirtualPatientAttempt.findOne({
    caseId,
    userId,
    status: "in_progress",
  }).sort({ startedAt: -1 });
  if (open) {
    if (!isExpired(open)) {
      return {
        attempt: open.toObject(),
        case: sanitizeVpForLearner(caseDoc, open.variantIndex ?? 0),
        resumed: true,
        secondsLeft: secondsLeft(open),
      };
    }
    open.status = "expired";
    open.durationMs = Date.now() - new Date(open.startedAt).getTime();
    await open.save();
  }

  const { fields } = await resolveAttemptStart({
    AttemptModel: VirtualPatientAttempt,
    station: "vp",
    caseId,
    userId,
    mode,
    caseTimeLimitSec: caseDoc.timeLimitSec ?? null,
  });
  // Вариант выбирается по номеру попытки — воспроизводимо и по кругу.
  const variantIndex = pickVariantIndex(fields.attemptNo, caseDoc.variants?.length ?? 0);
  const attempt = await VirtualPatientAttempt.create({
    caseId,
    userId,
    status: "in_progress",
    lang,
    ...fields,
    variantIndex,
    variantLabel: applyVpVariant(caseDoc, variantIndex).variantLabel,
  });
  recordRadiologyEvent({
    action: "vp.attempt_start",
    actorId: userId,
    attemptId: attempt._id,
    metadata: { mode: fields.mode, counted: fields.counted, attemptNo: fields.attemptNo },
  });
  return {
    attempt: attempt.toObject(),
    case: sanitizeVpForLearner(caseDoc, variantIndex),
    resumed: false,
    secondsLeft: secondsLeft(attempt),
  };
}

/**
 * Предварительная фиксация дифдиагноза — до раскрытия результатов.
 *
 * Обратной связи здесь НЕТ намеренно: врачу возвращается только факт
 * фиксации. Скажи мы сразу «угадал» — и предварительная версия превратилась
 * бы в подсказку, а вместе с ней исчез бы смысл всей затеи.
 */
export async function commitDifferential(attemptId, userId, text) {
  const attempt = await VirtualPatientAttempt.findById(attemptId);
  if (!attempt) throw new NotFoundError("VP attempt");
  if (String(attempt.userId) !== String(userId)) throw new ForbiddenError("Это чужая попытка");
  if (attempt.status !== "in_progress") throw new ConflictError("Попытка уже закрыта");
  if (isExpired(attempt)) throw new ConflictError("Время попытки истекло");
  if (attempt.commitment?.committedAt) {
    throw new ConflictError("Предварительный диагноз уже зафиксирован — менять его нельзя");
  }

  const caseDoc = await VirtualPatientCase.findById(attempt.caseId)
    .select("diagnosis")
    .lean();
  if (!caseDoc) throw new NotFoundError("VP case");

  const graded = scorePrior(caseDoc, { text, committedAt: new Date() });
  attempt.commitment = {
    text: String(text ?? "").trim(),
    committedAt: new Date(),
    orderedBefore: attempt.response.ordered?.length ?? 0,
    hit: graded.hit,
    matched: graded.matched,
    itemCount: countItems(text),
  };
  await attempt.save();

  recordRadiologyEvent({
    action: "vp.commit_prior",
    actorId: userId,
    attemptId: attempt._id,
    // Только структура: сама формулировка врача в аудит не уходит.
    metadata: { itemCount: attempt.commitment.itemCount, orderedBefore: attempt.commitment.orderedBefore },
  });

  return {
    committedAt: attempt.commitment.committedAt,
    orderedBefore: attempt.commitment.orderedBefore,
    itemCount: attempt.commitment.itemCount,
  };
}

// Назначить обследование: раскрываем результат И фиксируем заказ.
export async function orderInvestigation(attemptId, userId, key) {
  const attempt = await VirtualPatientAttempt.findById(attemptId);
  if (!attempt) throw new NotFoundError("VP attempt");
  if (String(attempt.userId) !== String(userId)) throw new ForbiddenError("Это чужая попытка");
  if (attempt.status === "submitted") throw new ConflictError("Попытка уже сдана");
  if (attempt.status === "expired") throw new ConflictError("Попытка просрочена");
  if (isExpired(attempt)) throw new ConflictError("Время попытки истекло");

  // В зачёте порядок жёсткий: сначала своя версия по жалобе, потом
  // обследования. Иначе «предварительный» диагноз перестаёт быть
  // предварительным, и компонент prior ничего не измеряет.
  if (attempt.mode === "exam" && !attempt.commitment?.committedAt) {
    throw new ConflictError(
      "Сначала зафиксируйте предварительный дифдиагноз по жалобе и анамнезу",
    );
  }

  const sourceCase = await VirtualPatientCase.findById(attempt.caseId).lean();
  if (!sourceCase) throw new NotFoundError("VP case");
  // Оценка — по кейсу на языке попытки, см. translatedCase.js.
  const caseDoc = await translatedCaseFor("vp", sourceCase, attempt.lang);
  // Результат отдаём из ТОГО варианта, который достался попытке, иначе врач
  // увидел бы цифры из базового кейса, а оценивался бы по своим.
  const { investigations } = applyVpVariant(caseDoc, attempt.variantIndex ?? 0);
  const inv = investigations.find((i) => i.key === key);
  if (!inv) throw new NotFoundError("Investigation");

  if (!attempt.response.ordered.includes(key)) {
    attempt.response.ordered.push(key);
    // Путь решения: что и когда заказано. В разборе видно, шёл ли врач от
    // жалобы к подтверждению или заказал всё подряд.
    attempt.response.orderLog.push({
      key,
      at: new Date(),
      necessary: Boolean(inv.necessary),
    });
    await attempt.save();
  }
  return {
    key: inv.key,
    name: inv.name,
    category: inv.category,
    resultText: inv.resultText,
    imageUrl: inv.imageUrl,
  };
}

function buildVpReview(caseDoc, attempt) {
  const orderedSet = new Set(attempt.response.ordered ?? []);
  return {
    diagnosis: {
      correctText: caseDoc.diagnosis?.correctText ?? "",
      diagnosisKeys: caseDoc.diagnosis?.diagnosisKeys ?? [],
    },
    // Предварительная версия рядом с итоговой: главный обучающий момент
    // сценария — увидеть, о чём думал сам до результатов.
    commitment: attempt.commitment?.committedAt
      ? {
          text: attempt.commitment.text,
          hit: attempt.commitment.hit,
          matched: attempt.commitment.matched,
          itemCount: attempt.commitment.itemCount,
          orderedBefore: attempt.commitment.orderedBefore,
        }
      : null,
    // Путь: в каком порядке заказывались обследования.
    orderLog: (attempt.response.orderLog ?? []).map((o) => ({
      name: caseDoc.investigations?.find((i) => i.key === o.key)?.name ?? o.key,
      necessary: o.necessary,
      at: o.at,
    })),
    workupDetail: attempt.workupDetail,
    // Полный список обследований с пометкой «нужное» и «назначал ли» —
    // чтобы учащийся увидел, что стоило заказать.
    investigations: (caseDoc.investigations ?? []).map((i) => ({
      name: i.name,
      category: i.category,
      necessary: i.necessary,
      ordered: orderedSet.has(i.key),
    })),
  };
}

export async function submitVpAttempt(attemptId, userId, response) {
  const attempt = await VirtualPatientAttempt.findById(attemptId);
  if (!attempt) throw new NotFoundError("VP attempt");
  if (String(attempt.userId) !== String(userId)) throw new ForbiddenError("Это чужая попытка");
  if (attempt.status === "submitted") throw new ConflictError("Попытка уже сдана");
  if (attempt.status === "expired") {
    throw new ConflictError("Попытка просрочена: лимит времени истёк");
  }

  const late = isExpired(attempt);
  if (late && attempt.counted) {
    attempt.counted = false;
    attempt.isFirstCounted = false;
    attempt.countedReason = "late";
  }
  attempt.lateSubmit = late;

  const sourceCase = await VirtualPatientCase.findById(attempt.caseId).lean();
  if (!sourceCase) throw new NotFoundError("VP case");
  // Оценка — по кейсу НА ЯЗЫКЕ ПОПЫТКИ: иначе верный диагноз, написанный
  // по-турецки, сверялся бы с русским списком и давал ноль.
  const caseDoc = await translatedCaseFor("vp", sourceCase, attempt.lang);

  // ordered берём из уже зафиксированных заказов (не из тела запроса).
  const resp = {
    ordered: attempt.response.ordered ?? [],
    orderLog: attempt.response.orderLog ?? [],
    diagnosisKeys: response.diagnosisKeys ?? [],
    diagnosisText: response.diagnosisText ?? "",
    reasoningText: response.reasoningText ?? "",
  };

  const det = scoreVp(caseDoc, resp);
  // Предварительная версия оценивается по тому, что было зафиксировано ДО
  // результатов; пересчитываем здесь, а не доверяем сохранённому hit.
  const prior = scorePrior(caseDoc, attempt.commitment);
  const aiFeedback = await gradeImpression({
    impressionText: resp.reasoningText,
    correctText: caseDoc.diagnosis?.correctText ?? "",
    diagnosisSynonyms: caseDoc.diagnosis?.diagnosisSynonyms ?? [],
  });

  const { total, passed } = combineTotal(
    {
      diagnosis: det.diagnosis,
      workup: det.workup,
      prior: prior.prior,
      reasoning: aiFeedback?.score ?? null,
    },
    WEIGHTS,
    PASS,
  );

  attempt.response = resp;
  attempt.workupDetail = det.workupDetail;
  attempt.aiFeedback = aiFeedback;
  attempt.score = {
    total,
    passed,
    diagnosis: det.diagnosis,
    workup: det.workup,
    prior: prior.prior,
    reasoning: aiFeedback?.score ?? null,
  };
  if (attempt.commitment?.committedAt) {
    attempt.commitment.hit = prior.hit;
    attempt.commitment.matched = prior.matched;
  }
  attempt.status = "submitted";
  attempt.submittedAt = new Date();
  attempt.durationMs = attempt.startedAt
    ? attempt.submittedAt.getTime() - new Date(attempt.startedAt).getTime()
    : null;

  if (attempt.counted) {
    attempt.integrity = assessIntegrity({
      signals: response.integrity ?? {},
      durationMs: attempt.durationMs,
      avgDurationMs: caseDoc.stats?.avgDurationMs ?? null,
      sampleSize: caseDoc.stats?.countedAttempts ?? 0,
      answerText: resp.reasoningText,
      expertText: caseDoc.diagnosis?.correctText ?? "",
      aiBaselineText: caseDoc.aiBaseline?.text ?? "",
      firstCountedAttempt: attempt.isFirstCounted,
    });
  }
  await attempt.save();

  // Статистика кейса: средний балл — только по первым зачётным попыткам.
  await recordCaseStats({
    CaseModel: VirtualPatientCase,
    caseId: attempt.caseId,
    total,
    isFirstCounted: attempt.isFirstCounted,
    durationMs: attempt.durationMs,
  });

  let game = null;
  try {
    game = await awardForAttempt({
      userId,
      score: total,
      passed,
      falseAlarms: det.overordered,
      caughtCritical: false,
      counted: attempt.counted,
      isFirstCounted: attempt.isFirstCounted,
    });
  } catch {
    /* игровой слой не критичен */
  }

  // Очередь повторения — только по зачётным попыткам. «Пропущенное» здесь —
  // не назначенные нужные обследования.
  try {
    if (attempt.counted)
      await updateReviewItem({
        userId,
        caseId: attempt.caseId,
        station: "vp",
        caseTitle: caseDoc.title,
        score: total,
        passed,
        missed: det.workupDetail?.missedNecessary?.length ?? 0,
      });
  } catch {
    /* очередь повторения не критична */
  }

  recordRadiologyEvent({
    action: "vp.attempt_submit",
    actorId: userId,
    attemptId: attempt._id,
    metadata: {
      total: Math.round(total * 100) / 100,
      passed,
      ordered: resp.ordered.length,
      mode: attempt.mode,
      counted: attempt.counted,
      countedReason: attempt.countedReason,
      attemptNo: attempt.attemptNo,
      lateSubmit: attempt.lateSubmit,
      priorCommitted: Boolean(attempt.commitment?.committedAt),
      integrityFlags: attempt.integrity?.flags ?? [],
    },
  });

  return { attempt: attempt.toObject(), review: buildVpReview(caseDoc, attempt), game };
}

export async function getVpAttempt(attemptId, userId) {
  const attempt = await VirtualPatientAttempt.findById(attemptId).lean();
  if (!attempt) throw new NotFoundError("VP attempt");
  if (String(attempt.userId) !== String(userId)) throw new ForbiddenError("Это чужая попытка");
  if (attempt.status === "submitted") {
    const caseDoc = await VirtualPatientCase.findById(attempt.caseId).lean();
    return { attempt, review: caseDoc ? buildVpReview(caseDoc, attempt) : null };
  }
  return { attempt, review: null };
}
