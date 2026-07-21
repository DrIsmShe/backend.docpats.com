// server/modules/education/education-attempts/services/attempt.service.js
//
// Прохождение: сборка сессии, приём ответов, скоринг, готовность.
//
// Ключевая идея модуля: состав пробного экзамена определяется blueprint
// программы, а не случайной выборкой. Именно поэтому «готовность к
// экзамену» получается осмысленной цифрой, а не средним по больнице.

import mongoose from "mongoose";
import ExamAttempt from "../models/examAttempt.model.js";
import ExamProgram from "../../education-catalog/models/examProgram.model.js";
import ExamItem from "../../education-items/models/examItem.model.js";
import {
  toLearnerView,
  recordItemStats,
} from "../../education-items/services/item.service.js";
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from "../../../../common/utils/errors.js";
import logger from "../../../../common/logger.js";

// Потолок времени на один вопрос — таймер приходит с клиента, и доверять
// ему полностью нельзя (вкладку могли оставить открытой на ночь).
const MAX_TIME_PER_QUESTION_MS = 30 * 60 * 1000;

// Сколько последних ответов учитывать при расчёте готовности по теме.
const READINESS_WINDOW = 50;

// ─── Сравнение ответа с ключом ────────────────────────────────────────
// Порядок вариантов не важен, дубликаты игнорируются.
export function isAnswerCorrect(selectedKeys, correctKeys) {
  const selected = new Set(selectedKeys ?? []);
  const correct = new Set(correctKeys ?? []);
  if (selected.size !== correct.size) return false;
  for (const key of correct) {
    if (!selected.has(key)) return false;
  }
  return true;
}

// ─── Разнарядка по blueprint ──────────────────────────────────────────
// Превращает веса тем в целые количества вопросов так, чтобы сумма точно
// равнялась questionCount. Дробные остатки раздаются по наибольшему
// остатку (метод Хэйра) — иначе округление вниз потеряет вопросы.
export function buildBlueprintPlan(blueprint, questionCount) {
  const sections = (blueprint ?? []).filter(
    (s) => !s.parentCode && s.weightPercent > 0,
  );
  if (sections.length === 0) return null;

  const totalWeight = sections.reduce((sum, s) => sum + s.weightPercent, 0);
  if (totalWeight <= 0) return null;

  const raw = sections.map((s) => ({
    topicCode: s.code,
    title: s.title,
    exact: (s.weightPercent / totalWeight) * questionCount,
  }));

  const plan = raw.map((r) => ({
    topicCode: r.topicCode,
    title: r.title,
    count: Math.floor(r.exact),
    remainder: r.exact - Math.floor(r.exact),
  }));

  let assigned = plan.reduce((sum, p) => sum + p.count, 0);
  const byRemainder = [...plan].sort((a, b) => b.remainder - a.remainder);
  let i = 0;
  while (assigned < questionCount && byRemainder.length) {
    byRemainder[i % byRemainder.length].count += 1;
    assigned += 1;
    i += 1;
  }

  return plan.map(({ topicCode, title, count }) => ({
    topicCode,
    title,
    count,
  }));
}

// ─── Случайная выборка вопросов ───────────────────────────────────────
// $sample на стороне Mongo: не тянем весь банк в память и не даём
// предсказуемый порядок (иначе банк выкачивается перебором страниц).
async function sampleItems({ programId, lang, topicCode, count, excludeIds }) {
  if (count <= 0) return [];

  const match = {
    programId: new mongoose.Types.ObjectId(String(programId)),
    status: "published",
  };
  if (lang) match.lang = lang;
  if (topicCode) match.topicCode = topicCode;
  if (excludeIds?.length) {
    match._id = {
      $nin: excludeIds.map((id) => new mongoose.Types.ObjectId(String(id))),
    };
  }

  return ExamItem.aggregate([
    { $match: match },
    { $sample: { size: count } },
    { $project: { _id: 1, version: 1, topicCode: 1 } },
  ]);
}

// ─── Слабые темы учащегося ────────────────────────────────────────────
// Используется режимом drill и экраном готовности.
export async function computeTopicPerformance(userId, programId) {
  const attempts = await ExamAttempt.find({
    userId,
    programId,
    status: { $in: ["submitted", "expired"] },
  })
    .sort({ createdAt: -1 })
    .limit(20)
    .select("score.byTopic")
    .lean();

  const acc = new Map();
  for (const attempt of attempts) {
    for (const topic of attempt.score?.byTopic ?? []) {
      const key = topic.topicCode ?? "__untagged__";
      const current = acc.get(key) ?? { correct: 0, total: 0, title: topic.title };
      current.correct += topic.correct;
      current.total += topic.total;
      acc.set(key, current);
    }
  }

  return Array.from(acc.entries()).map(([topicCode, v]) => ({
    topicCode: topicCode === "__untagged__" ? null : topicCode,
    title: v.title ?? null,
    correct: v.correct,
    total: v.total,
    percent: v.total ? Math.round((v.correct / v.total) * 100) : 0,
  }));
}

// ─── Детерминированный срез вопросов под один блок ────────────────────
// Порядок ДОЛЖЕН совпадать с getProgramBlocks (program.service): та же
// сортировка (createdAt, _id) и тот же lang-фильтр — иначе «Блок 2» на
// витрине и «Блок 2» в попытке разойдутся.
async function selectBlockItems({ programId, lang, blockSize, blockIndex }) {
  const match = {
    programId: new mongoose.Types.ObjectId(String(programId)),
    status: "published",
  };
  if (lang) match.lang = lang;

  return ExamItem.find(match)
    .sort({ createdAt: 1, _id: 1 })
    .skip(blockIndex * blockSize)
    .limit(blockSize)
    .select("_id version topicCode")
    .lean();
}

// ─── startAttempt ─────────────────────────────────────────────────────
export async function startAttempt({
  userId,
  programId,
  mode = "tutor",
  questionCount,
  durationMinutes,
  lang,
  topicCodes,
  blockIndex,
  clinicId = null,
}) {
  if (!userId) throw new ValidationError("userId is required");

  const program = await ExamProgram.findById(programId).lean();
  if (!program) throw new NotFoundError("Exam program");
  if (program.status !== "published") {
    throw new ConflictError("Exam program is not published");
  }

  // Нормализуем номер блока: попытка либо по всему тесту (null), либо по
  // конкретному блоку (целое ≥ 0).
  const normalizedBlockIndex =
    Number.isInteger(blockIndex) && blockIndex >= 0 ? blockIndex : null;

  // Незавершённая попытка блокирует новую — но точечно: по всему тесту это
  // одна «висящая» сессия, а по блокам конфликт считается отдельно на каждый
  // блок, чтобы можно было проходить блоки независимо.
  const openAttempt = await ExamAttempt.findOne({
    userId,
    programId,
    status: "in_progress",
    blockIndex: normalizedBlockIndex,
  })
    .select("_id")
    .lean();
  if (openAttempt) {
    throw new ConflictError(
      "You already have an attempt in progress for this program",
      { attemptId: String(openAttempt._id) },
    );
  }

  const effectiveLang = lang ?? program.languages?.[0] ?? "ru";
  const count = Math.min(
    questionCount ?? program.defaultQuestionCount ?? 60,
    200,
  );

  let selected = [];

  if (normalizedBlockIndex !== null) {
    // ─── Блок большого теста ───
    // Блок — это фиксированный набор вопросов, а не выборка по темам,
    // поэтому режимы mock/drill к нему неприменимы: оставляем tutor/timed.
    const blockSize = program.blockSize ?? 0;
    if (!blockSize || blockSize < 1) {
      throw new ConflictError("Тест не разбит на блоки");
    }
    if (mode !== "tutor" && mode !== "timed") mode = "tutor";

    selected = await selectBlockItems({
      programId,
      lang: effectiveLang,
      blockSize,
      blockIndex: normalizedBlockIndex,
    });
  } else if (mode === "mock") {
    // Пробный экзамен: состав строго по blueprint.
    const plan = buildBlueprintPlan(program.blueprint, count);
    if (!plan) {
      throw new ConflictError(
        "Program has no blueprint weights — mock exam cannot be assembled",
      );
    }
    for (const section of plan) {
      const picked = await sampleItems({
        programId,
        lang: effectiveLang,
        topicCode: section.topicCode,
        count: section.count,
        excludeIds: selected.map((s) => s._id),
      });
      selected.push(...picked);
    }
    // Недобор по редким темам добираем из общего пула, чтобы длина
    // экзамена совпадала с заявленной.
    if (selected.length < count) {
      const filler = await sampleItems({
        programId,
        lang: effectiveLang,
        count: count - selected.length,
        excludeIds: selected.map((s) => s._id),
      });
      selected.push(...filler);
    }
  } else if (mode === "drill") {
    // Добивка слабых мест: берём три худшие темы с достаточной статистикой.
    const performance = await computeTopicPerformance(userId, programId);
    const weak = performance
      .filter((t) => t.total >= 3 && t.topicCode)
      .sort((a, b) => a.percent - b.percent)
      .slice(0, 3);

    const targets = weak.length ? weak.map((t) => t.topicCode) : (topicCodes ?? []);
    if (targets.length === 0) {
      // Статистики ещё нет — drill вырождается в обычную тренировку.
      selected = await sampleItems({ programId, lang: effectiveLang, count });
    } else {
      const perTopic = Math.ceil(count / targets.length);
      for (const topicCode of targets) {
        const picked = await sampleItems({
          programId,
          lang: effectiveLang,
          topicCode,
          count: perTopic,
          excludeIds: selected.map((s) => s._id),
        });
        selected.push(...picked);
      }
      selected = selected.slice(0, count);
    }
  } else {
    // tutor / timed: либо по выбранным темам, либо из общего пула.
    if (topicCodes?.length) {
      const perTopic = Math.ceil(count / topicCodes.length);
      for (const topicCode of topicCodes) {
        const picked = await sampleItems({
          programId,
          lang: effectiveLang,
          topicCode,
          count: perTopic,
          excludeIds: selected.map((s) => s._id),
        });
        selected.push(...picked);
      }
      selected = selected.slice(0, count);
    } else {
      selected = await sampleItems({ programId, lang: effectiveLang, count });
    }
  }

  if (selected.length === 0) {
    throw new ConflictError(
      "No published questions match the requested criteria",
    );
  }

  // Таймер только для режимов, где он предусмотрен.
  const timed = mode === "timed" || mode === "mock";
  const minutes = timed
    ? (durationMinutes ?? program.defaultDurationMinutes ?? 90)
    : null;

  const attempt = await ExamAttempt.create({
    userId,
    programId,
    clinicId,
    mode,
    lang: effectiveLang,
    blockIndex: normalizedBlockIndex,
    questions: selected.map((item, index) => ({
      itemId: item._id,
      itemVersion: item.version ?? 1,
      topicCode: item.topicCode ?? null,
      order: index,
    })),
    status: "in_progress",
    startedAt: new Date(),
    expiresAt: minutes ? new Date(Date.now() + minutes * 60 * 1000) : null,
  });

  return attempt.toObject();
}

// Достаёт попытку и проверяет, что она принадлежит этому пользователю.
async function loadOwnedAttempt(attemptId, userId) {
  const attempt = await ExamAttempt.findById(attemptId);
  if (!attempt) throw new NotFoundError("Attempt");
  if (String(attempt.userId) !== String(userId)) {
    throw new ForbiddenError("This attempt belongs to another user");
  }
  return attempt;
}

// ─── getAttemptForLearner ─────────────────────────────────────────────
// Отдаёт вопросы БЕЗ ключей. Для уже отвеченных в режиме tutor —
// вместе с разбором, потому что учащийся его уже видел.
export async function getAttemptForLearner(attemptId, userId) {
  const attempt = await loadOwnedAttempt(attemptId, userId);

  const itemIds = attempt.questions.map((q) => q.itemId);
  const items = await ExamItem.find({ _id: { $in: itemIds } }).lean();
  const byId = new Map(items.map((i) => [String(i._id), i]));

  const answered = new Map(
    attempt.responses.map((r) => [String(r.itemId), r]),
  );

  const revealAnswers =
    attempt.status !== "in_progress" || attempt.mode === "tutor";

  const questions = attempt.questions
    .sort((a, b) => a.order - b.order)
    .map((q) => {
      const item = byId.get(String(q.itemId));
      if (!item) return null;
      const response = answered.get(String(q.itemId)) ?? null;
      // Разбор показываем только по уже отвеченному вопросу.
      const includeAnswer = revealAnswers && Boolean(response);
      return {
        order: q.order,
        ...toLearnerView(item, { includeAnswer }),
        response: response
          ? {
              selectedKeys: response.selectedKeys,
              isCorrect: includeAnswer ? response.isCorrect : undefined,
              flagged: response.flagged,
              timeSpentMs: response.timeSpentMs,
            }
          : null,
      };
    })
    .filter(Boolean);

  return {
    id: String(attempt._id),
    programId: String(attempt.programId),
    mode: attempt.mode,
    lang: attempt.lang,
    blockIndex: attempt.blockIndex ?? null,
    status: attempt.status,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    submittedAt: attempt.submittedAt,
    answeredCount: attempt.responses.length,
    totalCount: attempt.questions.length,
    score: attempt.status === "in_progress" ? null : attempt.score,
    questions,
  };
}

// ─── answerQuestion ───────────────────────────────────────────────────
// Проверка ответа происходит ТОЛЬКО здесь, на сервере.
export async function answerQuestion(
  attemptId,
  userId,
  { itemId, selectedKeys = [], timeSpentMs = 0, flagged = false },
) {
  const attempt = await loadOwnedAttempt(attemptId, userId);

  if (attempt.status !== "in_progress") {
    throw new ConflictError("Attempt is already finished");
  }
  if (attempt.expiresAt && attempt.expiresAt.getTime() < Date.now()) {
    // Время вышло — фиксируем как есть, ответ не принимаем.
    await submitAttempt(attemptId, userId, { expired: true });
    throw new ConflictError("Time is up, the attempt has been submitted");
  }

  const inAttempt = attempt.questions.some(
    (q) => String(q.itemId) === String(itemId),
  );
  if (!inAttempt) {
    throw new ValidationError("Question is not part of this attempt");
  }

  const item = await ExamItem.findById(itemId)
    .select("correctKeys explanation options references source")
    .lean();
  if (!item) throw new NotFoundError("Exam item");

  const isCorrect = isAnswerCorrect(selectedKeys, item.correctKeys);
  const clampedTime = Math.min(
    Math.max(Number(timeSpentMs) || 0, 0),
    MAX_TIME_PER_QUESTION_MS,
  );

  const existingIndex = attempt.responses.findIndex(
    (r) => String(r.itemId) === String(itemId),
  );
  const response = {
    itemId,
    selectedKeys,
    isCorrect,
    timeSpentMs: clampedTime,
    flagged,
    answeredAt: new Date(),
  };

  if (existingIndex >= 0) {
    // Переответ разрешён только там, где нет мгновенного разбора: в tutor
    // учащийся уже увидел правильный ответ, менять свой смысла нет.
    if (attempt.mode === "tutor") {
      throw new ConflictError("Question is already answered");
    }
    attempt.responses[existingIndex] = response;
  } else {
    attempt.responses.push(response);
  }

  await attempt.save();

  // В режиме tutor сразу отдаём разбор — это и есть суть режима.
  if (attempt.mode === "tutor") {
    return {
      isCorrect,
      correctKeys: item.correctKeys,
      explanation: item.explanation,
      optionExplanations: (item.options ?? []).map((o) => ({
        key: o.key,
        explanation: o.explanation ?? "",
      })),
      references: item.references ?? [],
      source: item.source,
    };
  }

  return { accepted: true, answeredCount: attempt.responses.length };
}

// ─── submitAttempt ────────────────────────────────────────────────────
// Скоринг + запись статистики вопросов одной транзакцией: расхождение
// между «попытка засчитана» и «статистика вопроса обновлена» испортило бы
// item analysis, а откатить его потом нечем.
export async function submitAttempt(attemptId, userId, { expired = false } = {}) {
  const attempt = await loadOwnedAttempt(attemptId, userId);
  if (attempt.status !== "in_progress") {
    return attempt.toObject();
  }

  const program = await ExamProgram.findById(attempt.programId)
    .select("blueprint passingScorePercent")
    .lean();

  const topicTitles = new Map(
    (program?.blueprint ?? []).map((s) => [s.code, s.title]),
  );

  const responsesById = new Map(
    attempt.responses.map((r) => [String(r.itemId), r]),
  );

  // Считаем по СОСТАВУ попытки, а не по ответам: неотвеченный вопрос —
  // это неверный ответ, иначе можно «набрать 100%», ответив на один.
  const byTopic = new Map();
  let correct = 0;
  let totalTimeMs = 0;

  for (const question of attempt.questions) {
    const key = question.topicCode ?? "__untagged__";
    const bucket = byTopic.get(key) ?? { correct: 0, total: 0 };
    bucket.total += 1;

    const response = responsesById.get(String(question.itemId));
    if (response?.isCorrect) {
      correct += 1;
      bucket.correct += 1;
    }
    totalTimeMs += response?.timeSpentMs ?? 0;
    byTopic.set(key, bucket);
  }

  const total = attempt.questions.length;
  const percent = total ? Math.round((correct / total) * 1000) / 10 : 0;
  const passingScorePercent = program?.passingScorePercent ?? null;

  attempt.status = expired ? "expired" : "submitted";
  attempt.submittedAt = new Date();
  attempt.score = {
    correct,
    total,
    percent,
    passed:
      passingScorePercent === null ? false : percent >= passingScorePercent,
    passingScorePercent,
    totalTimeMs,
    byTopic: Array.from(byTopic.entries()).map(([topicCode, v]) => ({
      topicCode: topicCode === "__untagged__" ? null : topicCode,
      title: topicCode === "__untagged__" ? null : (topicTitles.get(topicCode) ?? null),
      correct: v.correct,
      total: v.total,
      percent: v.total ? Math.round((v.correct / v.total) * 1000) / 10 : 0,
    })),
  };

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await attempt.save({ session });
      await recordItemStats(attempt.responses, session);
    });
  } finally {
    await session.endSession();
  }

  logger?.info?.(
    {
      attemptId: String(attempt._id),
      programId: String(attempt.programId),
      percent,
      mode: attempt.mode,
    },
    "exam attempt submitted",
  );

  return attempt.toObject();
}

// ─── listAttempts ─────────────────────────────────────────────────────
export async function listAttempts(userId, filters = {}) {
  const query = { userId };
  if (filters.programId) query.programId = filters.programId;
  if (filters.status) query.status = filters.status;
  if (filters.mode) query.mode = filters.mode;

  return ExamAttempt.find(query)
    .sort({ createdAt: -1 })
    .limit(Math.min(filters.limit ?? 50, 200))
    .select("-questions -responses")
    .lean();
}

// ─── getReadiness ─────────────────────────────────────────────────────
// Главный экран учащегося: готовность по темам blueprint и общая оценка,
// взвешенная теми же весами, что и настоящий экзамен.
//
// Темы, по которым ещё нет ответов, считаются нулевыми, но помечаются
// как untested — иначе «готовность 12%» на старте демотивирует без причины.
export async function getReadiness(userId, programId) {
  const program = await ExamProgram.findById(programId)
    .select("blueprint passingScorePercent title")
    .lean();
  if (!program) throw new NotFoundError("Exam program");

  const performance = await computeTopicPerformance(userId, programId);
  const byCode = new Map(performance.map((p) => [p.topicCode, p]));

  const sections = (program.blueprint ?? []).filter((s) => !s.parentCode);

  const topics = sections.map((section) => {
    const stat = byCode.get(section.code);
    return {
      topicCode: section.code,
      title: section.title,
      weightPercent: section.weightPercent,
      answered: stat?.total ?? 0,
      correct: stat?.correct ?? 0,
      percent: stat?.percent ?? 0,
      // Меньше READINESS_WINDOW/10 ответов — статистика ещё шумная.
      untested: (stat?.total ?? 0) < 5,
    };
  });

  const totalWeight = topics.reduce((s, t) => s + t.weightPercent, 0);
  const weighted = totalWeight
    ? topics.reduce((s, t) => s + t.percent * (t.weightPercent / totalWeight), 0)
    : 0;

  const answeredTopics = topics.filter((t) => !t.untested).length;

  return {
    programId: String(programId),
    programTitle: program.title,
    passingScorePercent: program.passingScorePercent ?? null,
    // Взвешенная готовность по blueprint.
    readinessPercent: Math.round(weighted * 10) / 10,
    // Покрытие: по скольким темам вообще есть осмысленная статистика.
    coveragePercent: topics.length
      ? Math.round((answeredTopics / topics.length) * 1000) / 10
      : 0,
    topics: topics.sort((a, b) => a.percent - b.percent),
    weakestTopics: topics
      .filter((t) => !t.untested)
      .sort((a, b) => a.percent - b.percent)
      .slice(0, 3)
      .map((t) => t.topicCode),
    windowSize: READINESS_WINDOW,
  };
}
