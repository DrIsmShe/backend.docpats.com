// server/modules/education/education-items/services/item.service.js
//
// Бизнес-логика банка вопросов + редакторский цикл.
//
// Здесь живут два гейта, ради которых модуль вообще так устроен:
//   assertItemIntegrity — вопрос структурно корректен (ключи, варианты)
//   assertPublishable   — вопрос ГОТОВ к показу учащимся: есть объяснения,
//                         заполнено происхождение, а ИИ-черновик прошёл
//                         ревью человеком.
//
// Второй гейт — не бюрократия. Публикация непроверенного медицинского
// вопроса, сгенерированного моделью из PDF, — это и юридический риск, и
// репутационный: врач, заучивший неверный ответ, вернётся с претензией.

import mongoose from "mongoose";
import ExamItem from "../models/examItem.model.js";
import ExamProgram from "../../education-catalog/models/examProgram.model.js";
import { recountPublishedItems } from "../../education-catalog/services/program.service.js";
import { SOURCE_KINDS_REQUIRING_REVIEW } from "../../constants.js";
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from "../../../../common/utils/errors.js";
import logger from "../../../../common/logger.js";

// Поля, изменение которых на опубликованном вопросе требует новой версии.
const CONTENT_FIELDS = ["stem", "options", "correctKeys", "explanation"];

// ─── Структурная целостность ──────────────────────────────────────────
export function assertItemIntegrity(item) {
  const options = item.options ?? [];
  const correctKeys = item.correctKeys ?? [];

  if (options.length < 2) {
    throw new ValidationError("Question must have at least 2 options");
  }

  const keys = options.map((o) => o.key);
  const duplicates = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (duplicates.length) {
    throw new ValidationError(`Duplicate option keys: ${duplicates.join(", ")}`);
  }

  if (correctKeys.length === 0) {
    throw new ValidationError("At least one correct answer is required");
  }

  const unknown = correctKeys.filter((k) => !keys.includes(k));
  if (unknown.length) {
    throw new ValidationError(
      `correctKeys reference unknown options: ${unknown.join(", ")}`,
    );
  }

  // Правила по типу вопроса.
  switch (item.type) {
    case "sba":
    case "vignette":
    case "image":
    case "case":
      // Single best answer: ровно один верный вариант.
      if (correctKeys.length !== 1) {
        throw new ValidationError(
          `Type "${item.type}" requires exactly one correct answer`,
        );
      }
      break;
    case "multi":
      if (correctKeys.length < 2) {
        throw new ValidationError(
          'Type "multi" requires at least two correct answers',
        );
      }
      if (correctKeys.length === options.length) {
        throw new ValidationError("All options cannot be correct");
      }
      break;
    case "true_false":
      if (options.length !== 2 || correctKeys.length !== 1) {
        throw new ValidationError(
          'Type "true_false" requires exactly 2 options and 1 correct answer',
        );
      }
      break;
    default:
      break;
  }
}

// ─── Готовность к публикации ──────────────────────────────────────────
// reviewerId передаётся, когда публикация идёт прямо из ревью: рецензент
// в этот момент ещё не записан в документ.
export function assertPublishable(item, { reviewerId = null } = {}) {
  assertItemIntegrity(item);

  // Объяснения НЕ обязательны — это решение редактора, а не системы.
  // Государственные сборники сплошь и рядом идут без разборов, и
  // блокировать из-за этого публикацию значит запретить импорт как класс.
  // Отсутствие разбора — вопрос качества банка, а не его корректности;
  // оно отражается в collectQualityWarnings() и в отчёте itemAnalysis.
  //
  // Ниже остаётся то, что качеством не является: корректность вопроса,
  // права на материал и проверка машинного извлечения человеком.

  const source = item.source;
  if (!source?.kind) {
    throw new ValidationError("source.kind is required");
  }
  // Заимствованный материал без указания органа и ссылки опубликовать
  // нельзя — иначе не доказать право на использование.
  if (
    ["public_government", "licensed"].includes(source.kind) &&
    !source.authority
  ) {
    throw new ValidationError(
      `source.authority is required for source kind "${source.kind}"`,
    );
  }
  if (source.kind === "licensed" && !source.licenseNote) {
    throw new ValidationError(
      'source.licenseNote is required for source kind "licensed"',
    );
  }

  // ГЛАВНЫЙ ГЕЙТ: машинно-извлечённый вопрос публикуется только после
  // ревью человеком.
  //
  // Два независимых признака, потому что это две разные оси:
  //   source.kind = "ai_generated" — содержание СОЗДАНО моделью;
  //   importJobId != null          — содержание ИЗВЛЕЧЕНО моделью из файла.
  // Официальный государственный тест, распознанный из PDF, имеет
  // source.kind = "public_government", но проверять его всё равно надо:
  // распознавание могло потерять вариант ответа или перепутать ключ.
  const machineDerived =
    SOURCE_KINDS_REQUIRING_REVIEW.includes(source.kind) ||
    Boolean(item.importJobId);

  if (machineDerived) {
    const reviewed = item.reviewedBy ?? reviewerId;
    if (!reviewed) {
      throw new ConflictError(
        "Machine-extracted question requires human review before publishing",
      );
    }
  }
}

// ─── Замечания к качеству ─────────────────────────────────────────────
// Не запреты, а подсказки редактору. Вопрос без разбора публикуется, но
// учащийся увидит только «верно/неверно» без объяснения почему — это
// стоит показать тому, кто нажимает «Опубликовать», а не решать за него.
export function collectQualityWarnings(item) {
  const warnings = [];

  if (!item.explanation || !item.explanation.trim()) {
    warnings.push(
      "нет общего объяснения — учащийся не увидит, почему верный ответ верен",
    );
  }

  const missing = (item.options ?? [])
    .filter((o) => !o.explanation || !o.explanation.trim())
    .map((o) => o.key);
  if (missing.length === (item.options ?? []).length) {
    warnings.push("нет объяснений к вариантам ответа");
  } else if (missing.length) {
    warnings.push(`нет объяснения к вариантам: ${missing.join(", ")}`);
  }

  if (!item.references?.length) {
    warnings.push("не указаны источники");
  }

  return warnings;
}

// Проверяет, что topicCode есть в blueprint программы.
async function assertTopicBelongsToProgram(programId, topicCode) {
  const program = await ExamProgram.findById(programId)
    .select("_id blueprint")
    .lean();
  if (!program) throw new NotFoundError("Exam program");

  if (!topicCode) return null;
  const known = program.blueprint.some((s) => s.code === topicCode);
  if (!known) {
    throw new ValidationError(
      `topicCode "${topicCode}" is not in the program blueprint`,
    );
  }
  return topicCode;
}

// ─── createItem ───────────────────────────────────────────────────────
export async function createItem(input) {
  await assertTopicBelongsToProgram(input.programId, input.topicCode);

  const draft = {
    programId: input.programId,
    topicCode: input.topicCode ?? null,
    lang: input.lang ?? undefined,
    type: input.type ?? "sba",
    stem: input.stem,
    stemImageUrl: input.stemImageUrl ?? null,
    options: input.options ?? [],
    correctKeys: input.correctKeys ?? [],
    explanation: input.explanation ?? "",
    references: input.references ?? [],
    difficulty: input.difficulty ?? "medium",
    tags: input.tags ?? [],
    source: input.source,
    importJobId: input.importJobId ?? null,
    aiConfidence: input.aiConfidence ?? null,
    createdBy: input.actorId ?? null,
  };

  assertItemIntegrity(draft);

  // Создать вопрос сразу опубликованным нельзя — только через ревью.
  // Это единственный путь к status: "published", и он один на всех.
  const doc = await ExamItem.create({ ...draft, status: "draft" });
  return doc.toObject();
}

// ─── listItems ────────────────────────────────────────────────────────
export async function listItems(filters = {}) {
  const query = {};
  if (filters.programId) query.programId = filters.programId;
  if (filters.status) query.status = filters.status;
  if (filters.topicCode) query.topicCode = filters.topicCode;
  if (filters.lang) query.lang = filters.lang;
  if (filters.type) query.type = filters.type;
  if (filters.difficulty) query.difficulty = filters.difficulty;
  if (filters.sourceKind) query["source.kind"] = filters.sourceKind;
  if (filters.importJobId) query.importJobId = filters.importJobId;
  if (filters.tag) query.tags = filters.tag;

  if (filters.q && filters.q.trim()) {
    const safe = filters.q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    query.stem = new RegExp(safe, "i");
  }

  return ExamItem.find(query)
    .sort({ updatedAt: -1 })
    .limit(Math.min(filters.limit ?? 100, 500))
    .lean();
}

// ─── getItemById ──────────────────────────────────────────────────────
export async function getItemById(id) {
  const doc = await ExamItem.findById(id).lean();
  if (!doc) throw new NotFoundError("Exam item");
  return doc;
}

// ─── updateItem ───────────────────────────────────────────────────────
export async function updateItem(id, input) {
  const existing = await ExamItem.findById(id);
  if (!existing) throw new NotFoundError("Exam item");

  if (existing.status === "archived") {
    throw new ConflictError("Archived question cannot be edited");
  }

  if (input.topicCode !== undefined) {
    await assertTopicBelongsToProgram(existing.programId, input.topicCode);
  }

  const update = {};
  const FIELDS = [
    "topicCode",
    "lang",
    "type",
    "stem",
    "stemImageUrl",
    "options",
    "correctKeys",
    "explanation",
    "references",
    "difficulty",
    "tags",
    "source",
  ];
  for (const field of FIELDS) {
    if (input[field] !== undefined) update[field] = input[field];
  }
  if (input.actorId !== undefined) update.updatedBy = input.actorId;

  // Целостность проверяем на объединённом состоянии, а не на патче.
  const merged = { ...existing.toObject(), ...update };
  assertItemIntegrity(merged);

  const contentChanged = CONTENT_FIELDS.some(
    (f) =>
      update[f] !== undefined &&
      JSON.stringify(update[f]) !== JSON.stringify(existing[f]),
  );

  // Правка содержания опубликованного вопроса не мутирует его на месте:
  // прошлые попытки должны и дальше ссылаться на ту версию, которую
  // учащийся видел. Создаём новую версию, старую архивируем.
  if (existing.status === "published" && contentChanged) {
    const { _id, createdAt, updatedAt, ...rest } = existing.toObject();
    const next = await ExamItem.create({
      ...rest,
      ...update,
      status: "in_review", // изменённое содержание проходит ревью заново
      version: (existing.version || 1) + 1,
      previousVersionId: existing._id,
      reviewedBy: null,
      reviewedAt: null,
      publishedAt: null,
    });
    existing.status = "archived";
    await existing.save();
    await recountPublishedItems(existing.programId);

    logger?.info?.(
      { itemId: String(existing._id), newItemId: String(next._id) },
      "published exam item forked into a new version",
    );
    return next.toObject();
  }

  if (contentChanged) update.version = (existing.version || 1) + 1;

  const doc = await ExamItem.findByIdAndUpdate(
    id,
    { $set: update },
    { new: true, runValidators: true },
  ).lean();
  return doc;
}

// ─── submitForReview ──────────────────────────────────────────────────
export async function submitForReview(id, actorId = null) {
  const existing = await ExamItem.findById(id);
  if (!existing) throw new NotFoundError("Exam item");
  if (!["draft", "rejected"].includes(existing.status)) {
    throw new ConflictError(
      `Cannot submit an item with status "${existing.status}" for review`,
    );
  }

  assertItemIntegrity(existing.toObject());

  existing.status = "in_review";
  existing.rejectionReason = null;
  if (actorId) existing.updatedBy = actorId;
  await existing.save();
  return existing.toObject();
}

// ─── reviewItem ───────────────────────────────────────────────────────
// decision: "approve" → published, "reject" → rejected.
// Единственный путь вопроса к учащимся. Вызывается только рецензентом
// (проверка роли — на роуте).
export async function reviewItem(id, { decision, reason = null, reviewerId }) {
  if (!reviewerId) throw new ValidationError("reviewerId is required");

  const existing = await ExamItem.findById(id);
  if (!existing) throw new NotFoundError("Exam item");
  if (existing.status !== "in_review") {
    throw new ConflictError(
      `Only items in review can be decided, got "${existing.status}"`,
    );
  }

  if (decision === "reject") {
    if (!reason || !reason.trim()) {
      throw new ValidationError("Rejection reason is required");
    }
    existing.status = "rejected";
    existing.rejectionReason = reason.trim();
    existing.reviewedBy = reviewerId;
    existing.reviewedAt = new Date();
    await existing.save();
    return existing.toObject();
  }

  if (decision !== "approve") {
    throw new ValidationError('decision must be "approve" or "reject"');
  }

  // Гейт публикации. Для ИИ-черновика reviewerId здесь и есть тот самый
  // человек, который снимает блокировку.
  assertPublishable(existing.toObject(), { reviewerId });

  existing.status = "published";
  existing.reviewedBy = reviewerId;
  existing.reviewedAt = new Date();
  existing.publishedAt = existing.publishedAt ?? new Date();
  existing.rejectionReason = null;
  await existing.save();

  await recountPublishedItems(existing.programId);

  logger?.info?.(
    {
      itemId: String(existing._id),
      programId: String(existing.programId),
      sourceKind: existing.source?.kind,
      // Пишем в лог, с какими пробелами вопрос ушёл в публикацию: позже
      // это единственный способ понять, какую часть банка нужно дописать.
      qualityWarnings: collectQualityWarnings(existing.toObject()),
    },
    "exam item published",
  );
  return existing.toObject();
}

// ─── archiveItem ──────────────────────────────────────────────────────
export async function archiveItem(id) {
  const doc = await ExamItem.findByIdAndUpdate(
    id,
    { $set: { status: "archived" } },
    { new: true },
  ).lean();
  if (!doc) throw new NotFoundError("Exam item");

  await recountPublishedItems(doc.programId);
  return doc;
}

// ─── toLearnerView ────────────────────────────────────────────────────
// Проекция вопроса для учащегося: БЕЗ correctKeys и объяснений.
// Единственная защита от «открыл DevTools и увидел ответ» — не отдавать
// ответ вовсе, пока вопрос не отвечен.
//
// includeAnswer=true используется только после ответа (режим tutor) и
// в итоговом разборе попытки.
export function toLearnerView(item, { includeAnswer = false } = {}) {
  const base = {
    id: String(item._id),
    programId: String(item.programId),
    topicCode: item.topicCode,
    type: item.type,
    lang: item.lang,
    stem: item.stem,
    stemImageUrl: item.stemImageUrl,
    difficulty: item.difficulty,
    version: item.version,
    options: (item.options ?? []).map((o) => ({
      key: o.key,
      text: o.text,
      imageUrl: o.imageUrl ?? null,
    })),
  };

  if (!includeAnswer) return base;

  return {
    ...base,
    correctKeys: item.correctKeys,
    explanation: item.explanation,
    references: item.references ?? [],
    optionExplanations: (item.options ?? []).map((o) => ({
      key: o.key,
      explanation: o.explanation ?? "",
    })),
    source: item.source,
  };
}

// ─── recordItemStats ──────────────────────────────────────────────────
// Вызывается при сдаче попытки. Один вопрос — один документ, обновляем
// атомарно через $inc, чтобы параллельные сдачи не затирали друг друга.
export async function recordItemStats(responses, session = null) {
  if (!Array.isArray(responses) || responses.length === 0) return;

  const ops = responses.map((r) => ({
    updateOne: {
      filter: { _id: r.itemId },
      update: {
        $inc: {
          "stats.served": 1,
          "stats.correct": r.isCorrect ? 1 : 0,
          "stats.totalTimeMs": r.timeSpentMs || 0,
        },
      },
    },
  }));

  // Счётчики по выбранным вариантам: показывают «мёртвые» дистракторы,
  // которые не выбирает никто — верный признак плохого вопроса.
  for (const r of responses) {
    for (const key of r.selectedKeys ?? []) {
      ops.push({
        updateOne: {
          filter: { _id: r.itemId, "stats.optionCounts.key": key },
          update: { $inc: { "stats.optionCounts.$.count": 1 } },
        },
      });
      ops.push({
        updateOne: {
          filter: { _id: r.itemId, "stats.optionCounts.key": { $ne: key } },
          update: { $push: { "stats.optionCounts": { key, count: 1 } } },
        },
      });
    }
  }

  await ExamItem.bulkWrite(ops, session ? { session } : {});
}

// ─── itemAnalysis ─────────────────────────────────────────────────────
// Отчёт редактору: какие вопросы стоит переписать.
//   pValue < 0.25  — почти никто не отвечает верно: вероятно, вопрос
//                    некорректен или ключ ответа неверный
//   pValue > 0.95  — не различает уровни подготовки, балласт
//   мёртвый дистрактор — вариант, который не выбрал никто
export async function itemAnalysis(programId, { minServed = 20 } = {}) {
  const items = await ExamItem.find({
    programId,
    status: "published",
    "stats.served": { $gte: minServed },
  })
    .select("stem topicCode difficulty stats options")
    .lean();

  return items
    .map((item) => {
      const served = item.stats.served;
      const pValue = served ? item.stats.correct / served : null;
      const counts = new Map(
        (item.stats.optionCounts ?? []).map((c) => [c.key, c.count]),
      );
      const deadDistractors = (item.options ?? [])
        .map((o) => o.key)
        .filter((key) => (counts.get(key) ?? 0) === 0);

      const flags = [];
      if (pValue !== null && pValue < 0.25) flags.push("too_hard_or_broken");
      if (pValue !== null && pValue > 0.95) flags.push("too_easy");
      if (deadDistractors.length) flags.push("dead_distractors");

      return {
        itemId: String(item._id),
        stem: item.stem.slice(0, 160),
        topicCode: item.topicCode,
        difficulty: item.difficulty,
        served,
        pValue: pValue === null ? null : Math.round(pValue * 1000) / 1000,
        avgTimeMs: served ? Math.round(item.stats.totalTimeMs / served) : null,
        deadDistractors,
        flags,
      };
    })
    .filter((r) => r.flags.length)
    .sort((a, b) => (a.pValue ?? 1) - (b.pValue ?? 1));
}

// Экспортируем модель для сборки сессий, чтобы attempts не тянул модель напрямую.
export { ExamItem };
export const toObjectId = (v) => new mongoose.Types.ObjectId(String(v));

// ─── reviewAllReady ───────────────────────────────────────────────────
// Пакетное одобрение очереди одного теста.
//
// Зачем: импорт сборника даёт сотню вопросов разом, и проходить их по
// одному — работа на вечер. При этом оператор УЖЕ смотрел их в разборе
// импорта: проставлял ключи ответов, отбраковывал мусор.
//
// Гейт при этом остаётся на месте. Одобряет по-прежнему человек — просто
// одним действием вместо ста, и решение фиксируется на каждом вопросе
// (reviewedBy = тот, кто нажал). Вопросы, которые нельзя публиковать —
// без правильного ответа, без органа для заимствованного материала, —
// пропускаются и возвращаются оператору списком: они требуют глазами.
//
// Идём по одному через reviewItem, а не bulk-обновлением: иначе
// разъедутся денормализованные счётчики и языки программы, которые
// пересчитывает именно он.
export async function reviewAllReady({ programId, reviewerId }) {
  if (!reviewerId) throw new ValidationError("reviewerId is required");
  if (!programId) throw new ValidationError("programId is required");

  const pending = await ExamItem.find({ programId, status: "in_review" })
    .select("_id")
    .lean();

  const approved = [];
  const skipped = [];

  for (const { _id } of pending) {
    try {
      await reviewItem(_id, { decision: "approve", reviewerId });
      approved.push(String(_id));
    } catch (err) {
      skipped.push({
        itemId: String(_id),
        reason: String(err?.message ?? err).slice(0, 300),
      });
    }
  }

  logger?.info?.(
    {
      programId: String(programId),
      reviewerId: String(reviewerId),
      approved: approved.length,
      skipped: skipped.length,
    },
    "bulk review finished",
  );

  return {
    approvedCount: approved.length,
    skippedCount: skipped.length,
    skipped: skipped.slice(0, 20),
  };
}
