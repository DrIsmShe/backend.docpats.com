// server/modules/radiology/radiology-attempts/services/attempt.service.js
//
// Жизненный цикл попытки: старт (выдаём санитизованный кейс без ответа) →
// сдача (считаем оценку и раскрываем эталон для разбора) → история.
//
// Правильный ответ клиент получает ТОЛЬКО после сдачи — до этого кейс
// уходит через sanitizeForLearner, где ни находок, ни заключения нет.

import RadiologyAttempt from "../models/radiologyAttempt.model.js";
import RadiologyCase from "../../radiology-cases/models/radiologyCase.model.js";
import { getReadingSystem } from "../../reading-systems/index.js";
import {
  sanitizeForLearner,
  recordAttemptStats,
} from "../../radiology-cases/services/case.service.js";
import { scoreDeterministic, combineTotal } from "./scoring.service.js";
import {
  previewPolicy,
  resolveAttemptStart,
  isExpired,
  secondsLeft,
} from "./attemptPolicy.js";
import { assessIntegrity } from "./integrity.service.js";
import { gradeImpression } from "./impressionGrader.js";
import { findingsForModality } from "../../lexicon/lexicon.js";
import {
  analyzeAttempt as aiAnalyze,
  isConfigured as aiConfigured,
} from "../../ai/aiDrafter.js";
import { awardForAttempt } from "../../game/game.service.js";
import { updateReviewItem } from "../../review/review.service.js";
import { recordRadiologyEvent } from "../../audit/audit.service.js";
import {
  NotFoundError,
  ConflictError,
  ForbiddenError,
  ServiceUnavailableError,
} from "../../../../common/utils/errors.js";

/**
 * Условия попытки ДО старта: пойдёт ли в зачёт, сколько времени даётся,
 * когда откроется следующая зачётная. Страница задания печатает это врачу
 * до первого клика — правила, о которых узнают после, правилами не являются.
 */
export async function getAttemptPolicy(caseId, userId, mode = "learn") {
  const caseDoc = await RadiologyCase.findById(caseId)
    .select("status timeLimitSec title modality")
    .lean();
  if (!caseDoc || caseDoc.status !== "published") {
    throw new NotFoundError("Radiology case");
  }
  // Веса берём из системы чтения этой модальности — правила на странице
  // задания печатают ровно те цифры, по которым потом считается балл.
  const rs = getReadingSystem(caseDoc.modality);
  return previewPolicy({
    AttemptModel: RadiologyAttempt,
    station: "radiology",
    caseId,
    userId,
    mode,
    caseTimeLimitSec: caseDoc.timeLimitSec ?? null,
    scoring: rs
      ? { weights: rs.scoring.weights, passThreshold: rs.scoring.passThreshold }
      : null,
  });
}

export async function startAttempt(caseId, userId, mode = "learn") {
  const caseDoc = await RadiologyCase.findById(caseId).lean();
  if (!caseDoc || caseDoc.status !== "published") {
    throw new NotFoundError("Radiology case");
  }

  // Незакрытая попытка по этому кейсу: продолжаем её, а не начинаем новую.
  // Закрыл вкладку и вернулся — тот же таймер, тот же зачёт. Раньше каждое
  // открытие страницы плодило запись in_progress, и они не чистились.
  const open = await RadiologyAttempt.findOne({
    caseId,
    userId,
    status: "in_progress",
  }).sort({ startedAt: -1 });

  if (open) {
    if (!isExpired(open)) {
      return {
        attempt: open.toObject(),
        case: sanitizeForLearner(caseDoc),
        resumed: true,
        secondsLeft: secondsLeft(open),
      };
    }
    // Лимит истёк, а попытку так и не сдали. Помечаем просроченной, но НЕ
    // удаляем: по ней считается «зачёт раз в 24 часа», иначе зачёт можно
    // было бы отменять, дав попытке сгореть.
    open.status = "expired";
    open.durationMs = Date.now() - new Date(open.startedAt).getTime();
    await open.save();
    recordRadiologyEvent({
      action: "attempt.expired",
      actorId: userId,
      caseId,
      attemptId: open._id,
      metadata: { mode: open.mode, counted: open.counted },
    });
  }

  const { fields } = await resolveAttemptStart({
    AttemptModel: RadiologyAttempt,
    station: "radiology",
    caseId,
    userId,
    mode,
    caseTimeLimitSec: caseDoc.timeLimitSec ?? null,
  });

  const attempt = await RadiologyAttempt.create({
    caseId,
    userId,
    status: "in_progress",
    ...fields,
  });

  recordRadiologyEvent({
    action: "attempt.start",
    actorId: userId,
    caseId,
    attemptId: attempt._id,
    metadata: {
      mode: fields.mode,
      counted: fields.counted,
      countedReason: fields.countedReason,
      attemptNo: fields.attemptNo,
    },
  });

  return {
    attempt: attempt.toObject(),
    case: sanitizeForLearner(caseDoc),
    resumed: false,
    secondsLeft: secondsLeft(attempt),
  };
}

// Разбор, который раскрывается после сдачи: эталон эксперта + как ответ
// учащегося с ним соотносится.
function buildReview(caseDoc, attempt) {
  return {
    findings: (caseDoc.findings ?? []).map((f) => ({
      key: f.key,
      imageIndex: f.imageIndex,
      label: f.label,
      significance: f.significance,
      geometry: f.geometry,
      required: f.required,
      explanation: f.explanation,
    })),
    impression: {
      correctText: caseDoc.impression?.correctText ?? "",
      diagnosisKeys: caseDoc.impression?.diagnosisKeys ?? [],
    },
    matches: attempt.matches,
    falseAlarms: attempt.falseAlarms,
  };
}

export async function submitAttempt(attemptId, userId, response) {
  const attempt = await RadiologyAttempt.findById(attemptId);
  if (!attempt) throw new NotFoundError("Radiology attempt");
  if (String(attempt.userId) !== String(userId)) {
    throw new ForbiddenError("Это чужая попытка");
  }
  if (attempt.status === "submitted") {
    throw new ConflictError("Попытка уже сдана");
  }
  if (attempt.status === "expired") {
    throw new ConflictError("Попытка просрочена: лимит времени истёк");
  }

  // Дедлайн считается от startedAt, сохранённого в базе, — клиентский таймер
  // обходится, этот нет. Сдачу после лимита принимаем (терять ответ жалко),
  // но зачётность снимаем: иначе лимит времени был бы декоративным.
  const late = isExpired(attempt);
  if (late && attempt.counted) {
    attempt.counted = false;
    attempt.isFirstCounted = false;
    attempt.countedReason = "late";
  }
  attempt.lateSubmit = late;

  const caseDoc = await RadiologyCase.findById(attempt.caseId).lean();
  if (!caseDoc) throw new NotFoundError("Radiology case");
  const rs = getReadingSystem(caseDoc.modality);
  if (!rs) throw new ConflictError("Нет системы чтения для этой модальности");

  const resp = {
    findings: response.findings ?? [],
    reviewedChecklist: response.reviewedChecklist ?? [],
    impressionText: response.impressionText ?? "",
    diagnosisKeys: response.diagnosisKeys ?? [],
    diagnosisText: response.diagnosisText ?? "",
  };

  // 1. Детерминированное ядро.
  const det = scoreDeterministic(caseDoc, resp, rs);

  // 2. ИИ/эвристика по свободному заключению (гибрид). null, если оценивать
  //    нечего, — тогда компонент просто исключается из нормировки.
  const aiFeedback = await gradeImpression({
    impressionText: resp.impressionText,
    correctText: caseDoc.impression?.correctText ?? "",
    diagnosisSynonyms: caseDoc.impression?.diagnosisSynonyms ?? [],
  });

  const components = {
    detection: det.detection,
    classification: det.classification,
    checklist: det.checklist,
    diagnosis: det.diagnosis,
    aiImpression: aiFeedback?.score ?? null,
  };
  const { total, passed } = combineTotal(
    components,
    rs.scoring.weights,
    rs.scoring.passThreshold,
  );

  attempt.response = resp;
  attempt.matches = det.matches;
  attempt.falseAlarms = det.falseAlarms;
  attempt.aiFeedback = aiFeedback;
  attempt.score = { total, passed, ...components };
  attempt.status = "submitted";
  attempt.submittedAt = new Date();
  attempt.durationMs = attempt.startedAt
    ? attempt.submittedAt.getTime() - new Date(attempt.startedAt).getTime()
    : null;

  // Сигналы добросовестности: только для зачётных попыток и только как
  // пометка автору — балл они не меняют (см. integrity.service.js).
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
  await recordAttemptStats(attempt.caseId, total, {
    isFirstCounted: attempt.isFirstCounted,
    durationMs: attempt.durationMs,
  });

  // Игровой слой «Диагностической арены»: начисляем XP, ведём серию и
  // достижения. Тихо — сбой геймификации не должен ронять сдачу попытки.
  let game = null;
  try {
    const caughtCritical = det.matches.some(
      (m) => m.significance === "critical" && m.outcome === "hit",
    );
    game = await awardForAttempt({
      userId,
      score: total,
      passed,
      falseAlarms: det.falseAlarms,
      caughtCritical,
      counted: attempt.counted,
      isFirstCounted: attempt.isFirstCounted,
    });
  } catch {
    /* игровой слой не критичен для результата */
  }

  // «Работа над ошибками»: слабый результат кладёт кейс на повторение,
  // уверенный — двигает интервал. Тихо — не критично для сдачи.
  // Только зачётные попытки: иначе кейс «закрывался» бы тренировочным
  // прогоном сразу после разбора, где виден правильный ответ.
  try {
    if (attempt.counted)
      await updateReviewItem({
        userId,
        caseId: attempt.caseId,
        station: "radiology",
        caseTitle: caseDoc.title,
        modality: caseDoc.modality,
        score: total,
        passed,
        missed: det.matches.filter((m) => m.outcome === "missed").length,
      });
  } catch {
    /* очередь повторения не критична */
  }

  recordRadiologyEvent({
    action: "attempt.submit",
    actorId: userId,
    caseId: attempt.caseId,
    attemptId: attempt._id,
    metadata: {
      total: Math.round(total * 100) / 100,
      passed,
      falseAlarms: det.falseAlarms,
      mode: attempt.mode,
      counted: attempt.counted,
      countedReason: attempt.countedReason,
      attemptNo: attempt.attemptNo,
      lateSubmit: attempt.lateSubmit,
      // Структурные пометки, не PHI: сами тексты в аудит не уходят.
      integrityFlags: attempt.integrity?.flags ?? [],
    },
  });

  return { attempt: attempt.toObject(), review: buildReview(caseDoc, attempt), game };
}

export async function getAttempt(attemptId, userId) {
  const attempt = await RadiologyAttempt.findById(attemptId).lean();
  if (!attempt) throw new NotFoundError("Radiology attempt");
  if (String(attempt.userId) !== String(userId)) {
    throw new ForbiddenError("Это чужая попытка");
  }

  // Разбор раскрываем только для сданной попытки — иначе эталон утёк бы
  // до ответа.
  if (attempt.status === "submitted") {
    const caseDoc = await RadiologyCase.findById(attempt.caseId).lean();
    return { attempt, review: caseDoc ? buildReview(caseDoc, attempt) : null };
  }
  return { attempt, review: null };
}

// ─── ИИ-разбор попытки ────────────────────────────────────────────────
// ИИ имеет право скорректировать врача, поставить диагноз и написать текст
// заключения и разбора. Опирается на снимок + эталон эксперта + ответ
// учащегося. Учебная надстройка над детерминированной оценкой, а не замена.
function buildAnalysisPrompt(caseDoc, attempt, lbl, areaMap) {
  const expert =
    (caseDoc.findings ?? [])
      .map((f) => `- ${lbl(f.label)} (${f.significance}): ${f.explanation || "—"}`)
      .join("\n") || "— (норма либо не задано)";

  const learnerFindings =
    (attempt.response?.findings ?? []).map((f) => lbl(f.label)).join(", ") ||
    "не отмечено";

  const matches =
    (attempt.matches ?? [])
      .map(
        (m) =>
          `- ${lbl(m.label)}: ${
            m.outcome === "hit"
              ? "найдено" + (m.labelCorrect ? " и верно названо" : ", но названо неверно")
              : "ПРОПУЩЕНО"
          }`,
      )
      .join("\n") || "—";

  const areas =
    (attempt.response?.reviewedChecklist ?? [])
      .map((k) => areaMap.get(k) ?? k)
      .join("; ") || "нет";

  return [
    `КЕЙС: ${caseDoc.title} (модальность ${caseDoc.modality}).`,
    caseDoc.clinicalContext ? `Клинический контекст: ${caseDoc.clinicalContext}` : null,
    "",
    "ЭТАЛОН ЭКСПЕРТА — находки:",
    expert,
    caseDoc.impression?.correctText ? `Заключение эксперта: ${caseDoc.impression.correctText}` : null,
    caseDoc.impression?.diagnosisKeys?.length
      ? `Принятый диагноз: ${caseDoc.impression.diagnosisKeys.join(", ")}`
      : null,
    "",
    "ОТВЕТ УЧАЩЕГОСЯ:",
    `Отмеченные находки: ${learnerFindings}.`,
    `Сверка с эталоном:\n${matches}`,
    `Ложных отметок: ${attempt.falseAlarms ?? 0}.`,
    `Области осмотра, по которым дан ответ: ${areas}.`,
    `Заключение учащегося: ${attempt.response?.impressionText || "не написано"}.`,
    `Диагноз учащегося: ${(attempt.response?.diagnosisKeys ?? []).join(", ") || "не указан"}.`,
    `Балл детерминированной оценки: ${Math.round((attempt.score?.total ?? 0) * 100)}%.`,
    "",
    "Составь диагноз, грамотное заключение и разбор ответа учащегося.",
  ]
    .filter((v) => v !== null)
    .join("\n");
}

export async function aiAnalyzeAttempt(attemptId, userId, { force = false } = {}) {
  const attempt = await RadiologyAttempt.findById(attemptId);
  if (!attempt) throw new NotFoundError("Radiology attempt");
  if (String(attempt.userId) !== String(userId)) {
    throw new ForbiddenError("Это чужая попытка");
  }
  if (attempt.status !== "submitted") {
    throw new ConflictError("Разбор доступен только после сдачи попытки");
  }
  // Кэш: уже разобранную попытку повторно в модель не гоняем.
  if (attempt.aiAnalysis && !force) return attempt.aiAnalysis;

  if (!aiConfigured()) {
    throw new ServiceUnavailableError(
      "ИИ-разбор не настроен: задайте ANTHROPIC_API_KEY в .env сервера",
    );
  }

  const caseDoc = await RadiologyCase.findById(attempt.caseId).lean();
  if (!caseDoc) throw new NotFoundError("Radiology case");

  const labelMap = new Map(
    findingsForModality(caseDoc.modality).map((t) => [t.key, t.label]),
  );
  const lbl = (k) => labelMap.get(k) ?? k;
  const rs = getReadingSystem(caseDoc.modality);
  const areaMap = new Map((rs?.checklist ?? []).map((c) => [c.key, c.label]));

  const result = await aiAnalyze({
    imageUrl: caseDoc.images?.[0]?.url,
    promptContext: buildAnalysisPrompt(caseDoc, attempt, lbl, areaMap),
  });

  const stored = {
    diagnosis: result.diagnosis,
    conclusion: result.conclusion,
    analysis: result.analysis,
  };
  attempt.aiAnalysis = stored;
  await attempt.save();

  recordRadiologyEvent({
    action: "attempt.ai_analysis",
    actorId: userId,
    caseId: attempt.caseId,
    attemptId: attempt._id,
    metadata: {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
    },
  });

  return stored;
}

export async function listAttempts(userId, { caseId = null, limit = 50 } = {}) {
  const query = { userId };
  if (caseId) query.caseId = caseId;
  return RadiologyAttempt.find(query)
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 200))
    .select("caseId mode status score submittedAt createdAt")
    .lean();
}
