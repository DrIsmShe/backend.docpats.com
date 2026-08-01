// server/modules/radiology/labs-station/lab.service.js
//
// Станция «Анализы»: жизненный цикл кейса + прохождение. Переиспользует
// движки арены — combineTotal (взвешивание компонентов), gradeImpression
// (оценка свободного текста) и awardForAttempt (начисление XP/серии), —
// поэтому своей игровой логики здесь нет, только доменная.

import LabCase from "./models/labCase.model.js";
import LabAttempt from "./models/labAttempt.model.js";
import ArenaCaseTranslation from "../translation/arenaCaseTranslation.model.js";
import { translatedCaseFor, translateCaseList } from "../translation/translatedCase.js";
import { combineTotal } from "../radiology-attempts/services/scoring.service.js";
import { gradeImpression } from "../radiology-attempts/services/impressionGrader.js";
import { gradeDiagnosis } from "../radiology-attempts/services/diagnosisMatcher.js";
import { paginate, titleFilter } from "../catalog.js";
import {
  previewPolicy,
  resolveAttemptStart,
  isExpired,
  secondsLeft,
} from "../radiology-attempts/services/attemptPolicy.js";
import { assessIntegrity } from "../radiology-attempts/services/integrity.service.js";
import {
  pickVariantIndex,
  applyLabVariant,
} from "../radiology-attempts/services/variantPicker.js";
import { recordCaseStats } from "../radiology-attempts/services/caseStats.service.js";
import { updateReviewItem } from "../review/review.service.js";
import { unresolvedAiIssues } from "../ai/aiReviewFields.js";
import { awardForAttempt } from "../game/game.service.js";
import { recordRadiologyEvent } from "../audit/audit.service.js";
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from "../../../common/utils/errors.js";

// Веса компонентов оценки станции. Здесь главное — правильно выделить
// значимые отклонения и поставить диагноз.
import { scheduleCaseTranslation } from "../translation/onPublish.js";

const WEIGHTS = { detection: 0.5, diagnosis: 0.35, impression: 0.15 };
const PASS = 0.7;

// ─── Скоринг ──────────────────────────────────────────────────────────
// variantIndex: значимые отклонения берём у ТОГО варианта, который врач видел.
// При других цифрах значимым может быть другой показатель, и оценивать по
// базовому эталону значило бы наказывать за правильный ответ.
function scoreLab(caseDoc, response, variantIndex = 0) {
  const panelKeys = new Set((caseDoc.panel ?? []).map((p) => p.key));
  const { significantAbnormal } = applyLabVariant(caseDoc, variantIndex);
  const gt = new Set(significantAbnormal ?? []);
  const flags = new Set((response.flags ?? []).filter((k) => panelKeys.has(k)));

  let tp = 0;
  let fp = 0;
  for (const k of flags) (gt.has(k) ? (tp += 1) : (fp += 1));
  const fn = [...gt].filter((k) => !flags.has(k)).length;

  let detection;
  if (gt.size === 0) detection = fp === 0 ? 1 : Math.max(0, 1 - 0.34 * fp);
  else detection = tp + fn + fp > 0 ? tp / (tp + fn + fp) : 0; // Жаккар

  // Диагноз: точное совпадение ключа ИЛИ вхождение ключа/синонима в
  // развёрнутую формулировку — см. diagnosisMatcher.
  const { score: diagnosis } = gradeDiagnosis({
    givenKeys: response.diagnosisKeys,
    givenText: response.diagnosisText,
    acceptedKeys: caseDoc.impression?.diagnosisKeys,
    synonyms: caseDoc.impression?.diagnosisSynonyms,
  });

  const nameByKey = new Map((caseDoc.panel ?? []).map((p) => [p.key, p.name]));
  const matches = [...gt].map((k) => ({
    key: k,
    name: nameByKey.get(k) ?? k,
    outcome: flags.has(k) ? "hit" : "missed",
  }));

  return { detection, diagnosis, matches, falsePositives: fp };
}

// ─── Гейт публикации ──────────────────────────────────────────────────
export function collectLabBlockers(doc) {
  const b = [];
  if ((doc.panel?.length ?? 0) < 2) b.push("добавьте минимум 2 показателя в панель");
  if (!(doc.impression?.diagnosisKeys?.length ?? 0))
    b.push("укажите принятый диагноз");
  if (["public_government", "licensed"].includes(doc.source?.kind) && !doc.source?.authority)
    b.push("для заимствованного материала не указан орган/издание");
  if (doc.source?.kind === "licensed" && !doc.source?.licenseNote)
    b.push("для лицензионного материала не указаны условия");
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
export async function createLabCase(input, actorId, actorRole) {
  const doc = await LabCase.create({
    title: input.title,
    clinicalContext: input.clinicalContext ?? "",
    difficulty: input.difficulty ?? "medium",
    categoryId: input.categoryId ?? null,
    panel: input.panel ?? [],
    significantAbnormal: input.significantAbnormal ?? [],
    variants: input.variants ?? [],
    impression: input.impression ?? {},
    source: input.source,
    status: "draft",
    // Метку автогенерации ставит только ночная задача — из HTTP-контроллера
    // она не приходит (в схеме создания поля нет).
    ...(input.autoGen ? { autoGen: input.autoGen } : {}),
    createdBy: actorId,
  });
  recordRadiologyEvent({
    action: "lab.create",
    actorId,
    actorRole,
    metadata: { panel: doc.panel.length },
  });
  return doc.toObject();
}

export async function updateLabCase(caseId, patch) {
  const doc = await LabCase.findById(caseId);
  if (!doc) throw new NotFoundError("Lab case");
  if (doc.status === "archived") {
    throw new ConflictError("Архивный кейс редактировать нельзя");
  }
  const FIELDS = [
    "title",
    "clinicalContext",
    "difficulty",
    "categoryId",
    "panel",
    "significantAbnormal",
    "variants",
    "impression",
    "source",
  ];
  for (const f of FIELDS) if (patch[f] !== undefined) doc[f] = patch[f];
  await doc.save();
  return doc.toObject();
}

// Статус: publish (с гейтом) / draft / archived. Полного review-цикла у
// станции анализов нет — здесь автор и рецензент один админ.
export async function setLabStatus(caseId, status, actorId, actorRole) {
  const doc = await LabCase.findById(caseId);
  if (!doc) throw new NotFoundError("Lab case");

  if (status === "published") {
    const blockers = collectLabBlockers(doc);
    if (blockers.length) {
      throw new ValidationError(`Опубликовать нельзя: ${blockers.join("; ")}`, {
        blockers,
      });
    }
    doc.status = "published";
    doc.publishedAt = doc.publishedAt ?? new Date();
    // Перевод на остальные языки — после публикации и не в этом запросе.
    scheduleCaseTranslation("labs", doc._id, { actorId });
  } else if (status === "draft" || status === "archived") {
    doc.status = status;
  } else {
    throw new ValidationError("Неизвестный статус");
  }
  await doc.save();
  recordRadiologyEvent({
    action: `lab.${status}`,
    actorId,
    actorRole,
    metadata: {},
  });
  return doc.toObject();
}

// Удаление НАСОВСЕМ — в отличие от статуса archived, который лишь прячет
// кейс. Ограничения те же, что у лучевой станции: опубликованный сначала в
// архив, кейс с попытками врачей не удаляется вообще (на него ссылаются
// разборы, очередь работы над ошибками и статистика).
export async function deleteLabCasePermanently(caseId, actorId, actorRole) {
  const doc = await LabCase.findById(caseId);
  if (!doc) throw new NotFoundError("Lab case");
  if (doc.status === "published") {
    throw new ConflictError(
      "Опубликованный кейс сначала уберите в архив — удалять то, что видят врачи, нельзя",
    );
  }
  const attempts = await LabAttempt.countDocuments({ caseId: doc._id });
  if (attempts > 0) {
    throw new ConflictError(
      `По кейсу есть попытки врачей (${attempts}) — на него ссылаются разборы и статистика. Уберите его в архив вместо удаления.`,
    );
  }

  await ArenaCaseTranslation.deleteMany({ caseType: "labs", caseId: doc._id });
  await LabCase.deleteOne({ _id: doc._id });

  recordRadiologyEvent({
    action: "lab.delete",
    actorId,
    actorRole,
    metadata: {
      status: doc.status,
      auto: Boolean(doc.autoGen?.isAuto),
      topicKey: doc.autoGen?.topicKey || null,
    },
  });
  return { deleted: true, id: String(doc._id) };
}

// lang задаётся для учащегося и НЕ задаётся для редактора: в админке нужны
// исходные названия, иначе редактор правит один текст, а видит другой.
export async function listLabCases({
  isEditor,
  scope,
  status,
  difficulty,
  q,
  skip,
  limit,
  lang = null,
}) {
  const query = {};
  if (isEditor && scope === "all") {
    if (status) query.status = status;
  } else {
    query.status = "published";
  }
  if (difficulty) query.difficulty = difficulty;

  const byTitle = titleFilter(q);
  if (byTitle) Object.assign(query, byTitle);

  const page = await paginate(LabCase, {
    query,
    // variants исключаем не для экономии: внутри варианта лежат его значимые
    // отклонения, то есть ключ ответа.
    select: "-significantAbnormal -impression -variants",
    skip,
    limit,
  });

  page.items = await translateCaseList("labs", page.items, lang);
  return page;
}

export async function getLabCaseFull(caseId) {
  const doc = await LabCase.findById(caseId).lean();
  if (!doc) throw new NotFoundError("Lab case");
  return { ...doc, publishBlockers: collectLabBlockers(doc) };
}

/**
 * Кейс для учащегося. variantIndex — какой числовой вариант ему достался
 * (0 = базовый кейс автора). Значения панели берутся из варианта, названия и
 * ключи показателей — из кейса: вариант меняет цифры, а не структуру.
 */
export function sanitizeLabForLearner(doc, variantIndex = 0) {
  const { panel, variantLabel } = applyLabVariant(doc, variantIndex);
  return {
    _id: doc._id,
    title: doc.title,
    clinicalContext: doc.clinicalContext,
    difficulty: doc.difficulty,
    variantLabel,
    // Врачу полезно знать, что у кейса есть варианты: это объясняет, почему
    // цифры не совпадают с тем, что показал коллега.
    variantCount: doc.variants?.length ?? 0,
    panel: (panel ?? []).map((p) => ({
      key: p.key,
      name: p.name,
      value: p.value,
      unit: p.unit,
      refRange: p.refRange,
    })),
  };
}

// ─── Прохождение ──────────────────────────────────────────────────────
/** Условия попытки до старта: зачёт или тренировка, лимит, когда следующий зачёт. */
export async function getLabPolicy(caseId, userId, mode = "learn") {
  const caseDoc = await LabCase.findById(caseId).select("status timeLimitSec").lean();
  if (!caseDoc || caseDoc.status !== "published") throw new NotFoundError("Lab case");
  return previewPolicy({
    AttemptModel: LabAttempt,
    station: "labs",
    caseId,
    userId,
    mode,
    caseTimeLimitSec: caseDoc.timeLimitSec ?? null,
    scoring: { weights: WEIGHTS, passThreshold: PASS },
  });
}

export async function startLabAttempt(caseId, userId, mode = "learn", lang = "ru") {
  const source = await LabCase.findById(caseId).lean();
  if (!source || source.status !== "published") {
    throw new NotFoundError("Lab case");
  }
  const caseDoc = await translatedCaseFor("labs", source, lang, { lazy: true });

  // Незакрытую попытку продолжаем; просроченную помечаем и заводим новую —
  // запись остаётся, чтобы слот «зачёт раз в 24 часа» не восстанавливался.
  const open = await LabAttempt.findOne({ caseId, userId, status: "in_progress" }).sort({
    startedAt: -1,
  });
  if (open) {
    if (!isExpired(open)) {
      return {
        attempt: open.toObject(),
        case: sanitizeLabForLearner(caseDoc, open.variantIndex ?? 0),
        resumed: true,
        secondsLeft: secondsLeft(open),
      };
    }
    open.status = "expired";
    open.durationMs = Date.now() - new Date(open.startedAt).getTime();
    await open.save();
  }

  const { fields } = await resolveAttemptStart({
    AttemptModel: LabAttempt,
    station: "labs",
    caseId,
    userId,
    mode,
    caseTimeLimitSec: caseDoc.timeLimitSec ?? null,
  });
  // Какой числовой вариант достаётся этой попытке — решаем по её номеру, а
  // не случайно: результат воспроизводим, а варианты идут по кругу.
  const variantIndex = pickVariantIndex(fields.attemptNo, caseDoc.variants?.length ?? 0);
  const attempt = await LabAttempt.create({
    caseId,
    userId,
    status: "in_progress",
    lang,
    ...fields,
    variantIndex,
    variantLabel: applyLabVariant(caseDoc, variantIndex).variantLabel,
  });
  recordRadiologyEvent({
    action: "lab.attempt_start",
    actorId: userId,
    attemptId: attempt._id,
    metadata: { mode: fields.mode, counted: fields.counted, attemptNo: fields.attemptNo },
  });
  return {
    attempt: attempt.toObject(),
    case: sanitizeLabForLearner(caseDoc, variantIndex),
    resumed: false,
    secondsLeft: secondsLeft(attempt),
  };
}

function buildLabReview(caseDoc, attempt) {
  const nameByKey = new Map((caseDoc.panel ?? []).map((p) => [p.key, p.name]));
  // Разбор показывает эталон ТОГО варианта, который решал врач.
  const { significantAbnormal } = applyLabVariant(caseDoc, attempt.variantIndex ?? 0);
  return {
    variantLabel: attempt.variantLabel ?? "",
    significantAbnormal: (significantAbnormal ?? []).map((k) => ({
      key: k,
      name: nameByKey.get(k) ?? k,
    })),
    impression: {
      correctText: caseDoc.impression?.correctText ?? "",
      diagnosisKeys: caseDoc.impression?.diagnosisKeys ?? [],
    },
    matches: attempt.matches,
    falsePositives: attempt.falsePositives,
  };
}

export async function submitLabAttempt(attemptId, userId, response) {
  const attempt = await LabAttempt.findById(attemptId);
  if (!attempt) throw new NotFoundError("Lab attempt");
  if (String(attempt.userId) !== String(userId)) {
    throw new ForbiddenError("Это чужая попытка");
  }
  if (attempt.status === "submitted") throw new ConflictError("Попытка уже сдана");
  if (attempt.status === "expired") {
    throw new ConflictError("Попытка просрочена: лимит времени истёк");
  }

  // Дедлайн проверяется на сервере от сохранённого startedAt. Сдачу после
  // лимита принимаем, но зачётность снимаем.
  const late = isExpired(attempt);
  if (late && attempt.counted) {
    attempt.counted = false;
    attempt.isFirstCounted = false;
    attempt.countedReason = "late";
  }
  attempt.lateSubmit = late;

  const sourceCase = await LabCase.findById(attempt.caseId).lean();
  if (!sourceCase) throw new NotFoundError("Lab case");
  // Оценка — по кейсу на языке попытки, см. translatedCase.js.
  const caseDoc = await translatedCaseFor("labs", sourceCase, attempt.lang);

  const resp = {
    flags: response.flags ?? [],
    impressionText: response.impressionText ?? "",
    diagnosisKeys: response.diagnosisKeys ?? [],
    diagnosisText: response.diagnosisText ?? "",
  };

  const det = scoreLab(caseDoc, resp, attempt.variantIndex ?? 0);
  const aiFeedback = await gradeImpression({
    impressionText: resp.impressionText,
    correctText: caseDoc.impression?.correctText ?? "",
    diagnosisSynonyms: caseDoc.impression?.diagnosisSynonyms ?? [],
  });

  const { total, passed } = combineTotal(
    { detection: det.detection, diagnosis: det.diagnosis, impression: aiFeedback?.score ?? null },
    WEIGHTS,
    PASS,
  );

  attempt.response = resp;
  attempt.matches = det.matches;
  attempt.falsePositives = det.falsePositives;
  attempt.aiFeedback = aiFeedback;
  attempt.score = {
    total,
    passed,
    detection: det.detection,
    diagnosis: det.diagnosis,
    impression: aiFeedback?.score ?? null,
  };
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
      answerText: resp.impressionText,
      expertText: caseDoc.impression?.correctText ?? "",
      aiBaselineText: caseDoc.aiBaseline?.text ?? "",
      firstCountedAttempt: attempt.isFirstCounted,
    });
  }
  await attempt.save();

  // Статистика кейса: средний балл — только по первым зачётным попыткам.
  await recordCaseStats({
    CaseModel: LabCase,
    caseId: attempt.caseId,
    total,
    isFirstCounted: attempt.isFirstCounted,
    durationMs: attempt.durationMs,
  });

  // Общий игровой слой арены (XP/серия/достижения). Тихо.
  let game = null;
  try {
    game = await awardForAttempt({
      userId,
      score: total,
      passed,
      falseAlarms: det.falsePositives,
      caughtCritical: false,
      counted: attempt.counted,
      isFirstCounted: attempt.isFirstCounted,
    });
  } catch {
    /* игровой слой не критичен */
  }

  // Очередь повторения — только по зачётным попыткам.
  try {
    if (attempt.counted)
      await updateReviewItem({
        userId,
        caseId: attempt.caseId,
        station: "labs",
        caseTitle: caseDoc.title,
        score: total,
        passed,
        missed: det.matches.filter((m) => m.outcome === "missed").length,
      });
  } catch {
    /* очередь повторения не критична */
  }

  recordRadiologyEvent({
    action: "lab.attempt_submit",
    actorId: userId,
    attemptId: attempt._id,
    metadata: {
      total: Math.round(total * 100) / 100,
      passed,
      mode: attempt.mode,
      counted: attempt.counted,
      countedReason: attempt.countedReason,
      attemptNo: attempt.attemptNo,
      lateSubmit: attempt.lateSubmit,
      integrityFlags: attempt.integrity?.flags ?? [],
    },
  });

  return { attempt: attempt.toObject(), review: buildLabReview(caseDoc, attempt), game };
}

export async function getLabAttempt(attemptId, userId) {
  const attempt = await LabAttempt.findById(attemptId).lean();
  if (!attempt) throw new NotFoundError("Lab attempt");
  if (String(attempt.userId) !== String(userId)) {
    throw new ForbiddenError("Это чужая попытка");
  }
  if (attempt.status === "submitted") {
    const caseDoc = await LabCase.findById(attempt.caseId).lean();
    return { attempt, review: caseDoc ? buildLabReview(caseDoc, attempt) : null };
  }
  return { attempt, review: null };
}
