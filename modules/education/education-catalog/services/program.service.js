// server/modules/education/education-catalog/services/program.service.js
//
// Бизнес-логика каталога экзаменационных программ.
//
// Конвенции:
//   - Модуль глобальный: clinicId НЕ является обязательным аргументом.
//     Приватные программы клиники фильтруются по ownerClinicId явно.
//   - RBAC проверяется на уровне роутов (requireEducationRole), сервис
//     принимает уже авторизованный вызов и следит только за целостностью.

import ExamProgram from "../models/examProgram.model.js";
import { translateProgramContent } from "./programTranslator.js";
import { EXAM_LANGUAGES, DEFAULT_EXAM_LANGUAGE } from "../../constants.js";
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from "../../../../common/utils/errors.js";
import logger from "../../../../common/logger.js";

// ─── Проверка карты тем ───────────────────────────────────────────────
// Blueprint — источник правды для сборки экзамена, поэтому кривой blueprint
// должен падать здесь, а не всплывать позже неверным составом вопросов.
export function assertValidBlueprint(blueprint) {
  if (!Array.isArray(blueprint) || blueprint.length === 0) return;

  const codes = new Set();
  for (const section of blueprint) {
    if (codes.has(section.code)) {
      throw new ValidationError(`Duplicate blueprint code: ${section.code}`);
    }
    codes.add(section.code);
  }

  // parentCode должен ссылаться на существующий раздел этой же программы.
  for (const section of blueprint) {
    if (section.parentCode && !codes.has(section.parentCode)) {
      throw new ValidationError(
        `Unknown parentCode "${section.parentCode}" in section "${section.code}"`,
      );
    }
    if (section.parentCode === section.code) {
      throw new ValidationError(`Section "${section.code}" is its own parent`);
    }
  }

  // Веса считаем только по верхнему уровню: подтемы делят вес родителя.
  const topLevelWeight = blueprint
    .filter((s) => !s.parentCode)
    .reduce((sum, s) => sum + (s.weightPercent || 0), 0);

  // Округление до 2 знаков — чтобы 33.33 * 3 не ловило ложное срабатывание.
  if (Math.round(topLevelWeight * 100) / 100 > 100) {
    throw new ValidationError(
      `Blueprint top-level weights sum to ${topLevelWeight}%, must not exceed 100%`,
    );
  }
}

// ─── Название теста на языке врача ────────────────────────────────────
//
// Перевода нет — отдаём оригинал. Это осознанный откат, а не заглушка: имя
// на чужом языке читается, пустое место — нет. Так же ведут себя рубрики
// каталога, кейсы арены и вопросы банка.
//
// Язык оригинала берём из primaryLang (что проставил админ), а без него — из
// первого языка, на котором есть вопросы. Совпал с языком врача — переводить
// нечего.
export function programSourceLang(program) {
  return (
    program?.primaryLang ||
    program?.languages?.[0] ||
    DEFAULT_EXAM_LANGUAGE
  );
}

export function localizeProgram(program, lang) {
  if (!program || !lang || lang === programSourceLang(program)) return program;
  const tr = (program.translations ?? []).find((t) => t.lang === lang);
  if (!tr?.title) return program;
  return {
    ...program,
    title: tr.title,
    description: tr.description || program.description,
  };
}

// Перевод названия и описания на остальные языки. БЕЗ await у вызывающего:
// редактор не должен ждать модель, чтобы опубликовать тест, а недоступность
// модели не повод не публиковать. Ошибку гасим в лог — ровно как перевод
// рубрики при создании и перевод вопроса при публикации.
export function scheduleProgramTranslation(programId) {
  setImmediate(async () => {
    try {
      const doc = await ExamProgram.findById(programId);
      if (!doc) return;
      const sourceLang = programSourceLang(doc);
      const targets = EXAM_LANGUAGES.filter((l) => l !== sourceLang);
      const translations = await translateProgramContent({
        title: doc.title,
        description: doc.description ?? "",
        sourceLang,
        targetLangs: targets,
      });
      if (!translations.length) return;
      doc.translations = translations;
      await doc.save();
      logger?.info?.(
        {
          programId: String(programId),
          langs: translations.map((t) => t.lang),
        },
        "exam program translated",
      );
    } catch (err) {
      logger?.error?.(
        { err, programId: String(programId) },
        "exam program translation failed",
      );
    }
  });
}

// ─── createProgram ────────────────────────────────────────────────────
export async function createProgram(input) {
  assertValidBlueprint(input.blueprint);

  const existing = await ExamProgram.findOne({ code: input.code })
    .select("_id")
    .lean();
  if (existing) {
    throw new ConflictError(`Program with code "${input.code}" already exists`);
  }

  const status = input.status ?? "draft";

  const doc = await ExamProgram.create({
    code: input.code,
    title: input.title,
    description: input.description ?? "",
    translations: input.translations ?? [],
    country: input.country,
    region: input.region,
    examType: input.examType,
    authority: input.authority ?? null,
    specialty: input.specialty ?? null,
    languages: input.languages ?? undefined,
    primaryLang: input.primaryLang ?? null,
    categoryId: input.categoryId ?? null,
    blockSize: input.blockSize ?? null,
    blueprint: input.blueprint ?? [],
    defaultQuestionCount: input.defaultQuestionCount ?? undefined,
    defaultDurationMinutes: input.defaultDurationMinutes ?? undefined,
    passingScorePercent: input.passingScorePercent ?? undefined,
    sourcePolicy: input.sourcePolicy ?? "original",
    sourceUrl: input.sourceUrl ?? null,
    licenseNote: input.licenseNote ?? null,
    ownerClinicId: input.ownerClinicId ?? null,
    isFree: input.isFree ?? false,
    status,
    publishedAt: status === "published" ? new Date() : null,
    createdBy: input.actorId ?? null,
  });

  return doc.toObject();
}

// ─── listPrograms ─────────────────────────────────────────────────────
// filters.scope:
//   "public"  — только опубликованные публичные программы (витрина)
//   "clinic"  — программы конкретной клиники (нужен filters.clinicId)
//   "all"     — всё (для редакторов каталога)
export async function listPrograms(filters = {}) {
  const query = {};

  const scope = filters.scope ?? "public";
  if (scope === "public") {
    query.status = "published";
    query.ownerClinicId = null;
  } else if (scope === "clinic") {
    if (!filters.clinicId) {
      throw new ValidationError("clinicId is required for scope=clinic");
    }
    query.ownerClinicId = filters.clinicId;
  } else if (filters.status) {
    query.status = filters.status;
  }

  if (filters.country) query.country = String(filters.country).toUpperCase();
  if (filters.region) query.region = filters.region;
  if (filters.examType) query.examType = filters.examType;
  if (filters.categoryId) query.categoryId = filters.categoryId;
  if (filters.specialty) query.specialty = filters.specialty;
  // ФИЛЬТР ПО ЯЗЫКУ — по наличию вопросов на этом языке.
  //
  // Здесь стоял отбор по ОДНОМУ основному языку (primaryLang), и это был
  // обходной путь: у теста не было переведённого названия, поэтому врач,
  // выбравший English, получал карточку «Типология личности по Карлу Юнгу»
  // с русским заголовком — вопросы на английском есть, а список нечитаем.
  //
  // Теперь название и описание переводятся вместе с вопросами
  // (programTranslator + localizeProgram ниже), и обходной путь только мешал:
  // переведённый тест по-прежнему показывался ровно на одном языке. Один
  // тест — одна карточка, читаемая на языке врача, и видна везде, где у
  // теста есть вопросы.
  //
  // primaryLang остаётся языком ОРИГИНАЛА: от него считается, что переводить
  // и к чему откатываться, когда перевода нет.
  if (filters.language) {
    query.languages = filters.language;
  }
  if (filters.isFree !== undefined) query.isFree = filters.isFree;

  if (filters.q && filters.q.trim()) {
    const safe = filters.q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(safe, "i");
    query.$or = [{ title: rx }, { code: rx }, { authority: rx }];
  }

  const items = await ExamProgram.find(query)
    .sort({ country: 1, title: 1 })
    .limit(Math.min(filters.limit ?? 200, 500))
    .lean();

  // Локализуем ТОЛЬКО витрину. В админке (scope=all/clinic) заголовок обязан
  // остаться оригинальным: там его переименовывают, и подставленный перевод
  // сохранился бы поверх оригинала при первой же правке.
  if (!filters.lang || scope !== "public") return items;
  return items.map((p) => localizeProgram(p, filters.lang));
}

// ─── listCountries ────────────────────────────────────────────────────
// Навигация витрины «экзамены по странам»: сколько опубликованных программ
// в каждой стране и какие типы экзаменов там есть.
export async function listCountries() {
  return ExamProgram.aggregate([
    { $match: { status: "published", ownerClinicId: null } },
    {
      $group: {
        _id: { country: "$country", region: "$region" },
        programCount: { $sum: 1 },
        examTypes: { $addToSet: "$examType" },
        languages: { $addToSet: "$languages" },
      },
    },
    {
      $project: {
        _id: 0,
        country: "$_id.country",
        region: "$_id.region",
        programCount: 1,
        examTypes: 1,
        // languages собирается как массив массивов — схлопываем.
        languages: {
          $reduce: {
            input: "$languages",
            initialValue: [],
            in: { $setUnion: ["$$value", "$$this"] },
          },
        },
      },
    },
    { $sort: { region: 1, country: 1 } },
  ]);
}

// ─── getProgramById ───────────────────────────────────────────────────
// lang задан — отдаём заголовок и описание на нём (страница теста у врача).
// Без lang возвращается оригинал: так ходит админка, и подставленный перевод
// она сохранила бы поверх оригинала при первой же правке.
export async function getProgramById(id, { lang = null } = {}) {
  const doc = await ExamProgram.findById(id).lean();
  if (!doc) throw new NotFoundError("Exam program");
  return lang ? localizeProgram(doc, lang) : doc;
}

// ─── getProgramByCode ─────────────────────────────────────────────────
export async function getProgramByCode(code, { lang = null } = {}) {
  const doc = await ExamProgram.findOne({
    code: String(code).toLowerCase(),
  }).lean();
  if (!doc) throw new NotFoundError("Exam program");
  return lang ? localizeProgram(doc, lang) : doc;
}

// ─── updateProgram ────────────────────────────────────────────────────
export async function updateProgram(id, input) {
  const existing = await ExamProgram.findById(id);
  if (!existing) throw new NotFoundError("Exam program");

  const update = {};
  const FIELDS = [
    "title",
    "description",
    "translations",
    "country",
    "region",
    "examType",
    "authority",
    "specialty",
    "languages",
    "primaryLang",
    "categoryId",
    "blockSize",
    "defaultQuestionCount",
    "defaultDurationMinutes",
    "passingScorePercent",
    "sourcePolicy",
    "sourceUrl",
    "licenseNote",
    "isFree",
  ];
  for (const field of FIELDS) {
    if (input[field] !== undefined) update[field] = input[field];
  }

  if (input.blueprint !== undefined) {
    assertValidBlueprint(input.blueprint);
    // Удаление раздела, на который уже ссылаются вопросы, осиротит их
    // topicCode — блокируем, чтобы скоринг по темам не поехал.
    const removed = existing.blueprint
      .map((s) => s.code)
      .filter((code) => !input.blueprint.some((s) => s.code === code));
    if (removed.length) {
      const { default: ExamItem } = await import(
        "../../education-items/models/examItem.model.js"
      );
      const inUse = await ExamItem.findOne({
        programId: existing._id,
        topicCode: { $in: removed },
        status: { $ne: "archived" },
      })
        .select("_id topicCode")
        .lean();
      if (inUse) {
        throw new ConflictError(
          `Blueprint section "${inUse.topicCode}" still has active items`,
        );
      }
    }
    update.blueprint = input.blueprint;
  }

  const becomesPublished =
    input.status !== undefined &&
    input.status !== existing.status &&
    input.status === "published";

  if (input.status !== undefined && input.status !== existing.status) {
    update.status = input.status;
    if (input.status === "published" && !existing.publishedAt) {
      update.publishedAt = new Date();
    }
  }

  if (input.actorId !== undefined) update.updatedBy = input.actorId;

  // ─── Перевод названия и описания ───
  //
  // Текст изменился — прежние переводы относятся к другому названию. Стираем
  // их СРАЗУ, не дожидаясь новых: тест, переименованный в «Кардиологию», не
  // должен ни секунды показываться азербайджанскому врачу как «Nevrologiya».
  // Оригинал в этот промежуток читается, устаревший перевод — врёт.
  const textChanged =
    (update.title !== undefined && update.title !== existing.title) ||
    (update.description !== undefined &&
      update.description !== existing.description);
  // Переводы, присланные явно (импорт, ручная правка), стирать не за что.
  if (textChanged && input.translations === undefined) update.translations = [];

  const doc = await ExamProgram.findByIdAndUpdate(
    id,
    { $set: update },
    { new: true, runValidators: true },
  ).lean();

  // Переводим ПРИ ПУБЛИКАЦИИ, а не при каждой правке черновика: черновик
  // переименовывают по нескольку раз (в том числе автоматически — модель
  // предлагает название по содержимому), и каждый такой раз стоил бы вызова
  // модели впустую. У опубликованного теста наоборот: он уже на витрине, и
  // переводы обязаны оставаться свежими.
  const needsTranslation =
    becomesPublished || (textChanged && doc.status === "published");
  if (needsTranslation && String(doc.title ?? "").trim()) {
    scheduleProgramTranslation(doc._id);
  }

  return doc;
}

// ─── archiveProgram ───────────────────────────────────────────────────
export async function archiveProgram(id) {
  const doc = await ExamProgram.findByIdAndUpdate(
    id,
    { $set: { status: "archived" } },
    { new: true },
  ).lean();
  if (!doc) throw new NotFoundError("Exam program");

  logger?.info?.({ programId: String(id) }, "exam program archived");
  return doc;
}

// ─── deleteProgram (жёсткое удаление) ─────────────────────────────────
// Архив прячет тест, но данные оставляет; здесь — удаление насовсем вместе
// с банком вопросов. История сдач ценна (по ней строится готовность и
// item analysis прошлых лет), поэтому если по тесту уже есть попытки —
// удаление запрещаем и предлагаем архив. Так «Удалить» никогда не стирает
// молча чужой прогресс.
export async function deleteProgram(id, { force = false } = {}) {
  const program = await ExamProgram.findById(id).select("_id title").lean();
  if (!program) throw new NotFoundError("Exam program");

  const { default: ExamAttempt } = await import(
    "../../education-attempts/models/examAttempt.model.js"
  );
  const attempt = await ExamAttempt.findOne({ programId: id })
    .select("_id")
    .lean();

  // По умолчанию бережём историю: если есть попытки — не удаляем, предлагаем
  // архив. force=true — осознанное решение админа стереть всё вместе с
  // историей сдач (для мусорных черновиков импорта это единственный выход).
  if (attempt && !force) {
    throw new ConflictError(
      "По тесту есть пройденные или начатые попытки — удаление запрещено. Уберите тест в архив, чтобы сохранить историю сдач.",
      { reason: "has_attempts" },
    );
  }

  let attemptsDeleted = 0;
  if (force) {
    const r = await ExamAttempt.deleteMany({ programId: id });
    attemptsDeleted = r.deletedCount ?? 0;
  }

  const { default: ExamItem } = await import(
    "../../education-items/models/examItem.model.js"
  );
  const { deletedCount: itemsDeleted } = await ExamItem.deleteMany({
    programId: id,
  });
  await ExamProgram.deleteOne({ _id: id });

  logger?.info?.(
    { programId: String(id), itemsDeleted, attemptsDeleted, force },
    "exam program hard-deleted",
  );
  return { deleted: true, id: String(id), itemsDeleted, attemptsDeleted };
}

// ─── getProgramBlocks ─────────────────────────────────────────────────
// Делит опубликованные вопросы теста на блоки по program.blockSize. Блок —
// детерминированный срез, отсортированный по (createdAt, _id): та же
// сортировка используется при сборке попытки (attempt.service), поэтому
// «Блок 2» здесь и «Блок 2» там — один и тот же набор вопросов.
//
// СЧИТАЕМ НА ЯЗЫКЕ ВРАЧА, если тест на нём есть, иначе на языке оригинала.
// Это должно совпадать с правилом сборки попытки (attempt.service →
// effectiveLang): экран блоков показывает «Блок 2 · 50 вопросов», а попытку
// по этому блоку собирает другой код. Разойдись они в языке — и человек
// получил бы не тот срез, который выбирал.
//
// Нумерация стабильна внутри языка, а не поперёк языков: перевод — отдельный
// документ со своим createdAt, и сортировка (createdAt, _id) на разных языках
// может нарезать границы по-разному. Для врача это незаметно (он всегда в
// одном языке), а требовать общий срез значило бы собирать блок по
// оригиналам и подменять каждый вопрос переводом при выдаче — отдельная
// работа, к переводу каталога отношения не имеющая.
export async function getProgramBlocks(programId, { lang } = {}) {
  const program = await ExamProgram.findById(programId)
    .select("blockSize languages status title")
    .lean();
  if (!program) throw new NotFoundError("Exam program");

  const blockSize = program.blockSize ?? 0;
  const available = program.languages ?? [];
  const effectiveLang =
    (lang && available.includes(lang) && lang) || available[0] || "ru";

  if (!blockSize || blockSize < 1) {
    return { blockSize: null, lang: effectiveLang, totalCount: 0, blocks: [] };
  }

  const { default: ExamItem } = await import(
    "../../education-items/models/examItem.model.js"
  );
  const totalCount = await ExamItem.countDocuments({
    programId,
    status: "published",
    lang: effectiveLang,
  });

  const blockCount = Math.ceil(totalCount / blockSize);
  const blocks = [];
  for (let i = 0; i < blockCount; i += 1) {
    const from = i * blockSize + 1;
    const to = Math.min((i + 1) * blockSize, totalCount);
    blocks.push({ index: i, from, to, count: to - from + 1 });
  }

  return { blockSize, lang: effectiveLang, totalCount, blocks };
}

// ─── recountPublishedItems ────────────────────────────────────────────
// Денормализованные поля витрины. Вызывается из item.service при смене
// статуса вопроса и из ingest.service после импорта — точное значение
// важнее скорости, поэтому считаем заново, а не инкрементим (инкремент
// рассинхронится на любой ошибке).
//
// Вместе со счётчиком пересобираем и languages: язык теста — производная
// от банка вопросов, а не то, что выбрали в форме импорта. Форма
// подставляет "ru" по умолчанию, и азербайджанский тест из-за этого
// оказывался в каталоге русским — фильтр по языку его не находил.
//
// Языки считаем по вопросам во всех рабочих статусах, кроме archived и
// rejected: сразу после импорта вопросы лежат в in_review, но язык теста
// уже должен быть верным. Если вопросов нет вовсе — не трогаем то, что
// выставил админ руками.
export async function recountPublishedItems(programId) {
  const { default: ExamItem } = await import(
    "../../education-items/models/examItem.model.js"
  );

  const [count, langs] = await Promise.all([
    // Переводы из счёта исключены: вопрос и четыре его перевода — это ОДИН
    // вопрос, а не пять. Без этого фильтра витрина показывала бы «500
    // вопросов» там, где их сто, и врач, увидевший цифру, решил бы, что банк
    // впятеро больше, чем есть. `translationOf: null` ловит и старые
    // документы, где поля ещё нет.
    ExamItem.countDocuments({ programId, status: "published", translationOf: null }),
    // А вот языки считаем по ВСЕМ вопросам, включая переводы: как раз они и
    // делают тест доступным на пяти языках, и каталог должен это показывать.
    ExamItem.distinct("lang", {
      programId,
      status: { $nin: ["archived", "rejected"] },
    }),
  ]);

  const patch = { publishedItemCount: count };

  // Порядок берём из EXAM_LANGUAGES, а не из distinct: он недетерминирован,
  // а languages[0] используется как язык по умолчанию при старте попытки
  // (см. attempt.service → effectiveLang).
  const contentLangs = EXAM_LANGUAGES.filter((l) => langs.includes(l));
  if (contentLangs.length > 0) patch.languages = contentLangs;

  await ExamProgram.updateOne({ _id: programId }, { $set: patch });
  return count;
}
