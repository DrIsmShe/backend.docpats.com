// server/modules/education/education-ingest/services/ingest.service.js
//
// Импорт вопросов из файла: приём → извлечение → правка оператором →
// перенос в банк вопросов.
//
// Решение по хранению исходника: файл НЕ сохраняется на сервере. Он живёт
// в памяти ровно на время извлечения. Причины две — не плодить копии
// потенциально лицензионных материалов и не держать лишний рубеж утечки.
// Если оператору нужен оригинал для сверки, он указывает внешнюю ссылку
// в file.url при создании задания.

import ExamImportJob from "../models/examImportJob.model.js";
import ExamProgram from "../../education-catalog/models/examProgram.model.js";
import { getExtractor, getActiveExtractorName } from "../extractors/index.js";
import {
  updateProgram,
  recountPublishedItems,
} from "../../education-catalog/services/program.service.js";
import {
  createItem,
  submitForReview,
} from "../../education-items/services/item.service.js";
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from "../../../../common/utils/errors.js";
import { EXAM_LANGUAGES } from "../../constants.js";
import logger from "../../../../common/logger.js";

// Черновики ниже этого порога уверенности помечаются в отчёте как
// требующие обязательной ручной сверки.
const LOW_CONFIDENCE_THRESHOLD = 0.6;

// ─── Построение карты тем из предложения ИИ ───────────────────────────
//
// Работает ТОЛЬКО когда у программы ещё нет blueprint. Если админ уже
// разметил темы руками, предложение модели игнорируется целиком: чужая
// разметка поверх ручной сломала бы и скоринг, и уже существующие вопросы.
//
// Веса нормализуются к 100 — модель ошибается в арифметике чаще, чем в
// содержании, и падать из-за суммы 99.7 было бы глупо.
export function buildBlueprintFromSuggestion(suggestion) {
  const topics = Array.isArray(suggestion?.topics) ? suggestion.topics : [];
  if (topics.length === 0) return null;

  const seen = new Set();
  const cleaned = [];

  for (const topic of topics) {
    const code = String(topic.code ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, "-")
      .slice(0, 80);
    const title = String(topic.title ?? "").trim().slice(0, 200);
    if (!code || !title || seen.has(code)) continue;
    seen.add(code);
    cleaned.push({
      code,
      title,
      parentCode: null,
      weightPercent: Number(topic.weightPercent) || 0,
    });
  }

  if (cleaned.length === 0) return null;

  const total = cleaned.reduce((sum, t) => sum + t.weightPercent, 0);
  if (total <= 0) {
    // Модель не проставила веса — делим поровну, иначе пробный экзамен
    // не соберётся: разнарядка по blueprint требует ненулевых весов.
    const even = Math.floor((100 / cleaned.length) * 100) / 100;
    return cleaned.map((t) => ({ ...t, weightPercent: even }));
  }

  return cleaned.map((t) => ({
    ...t,
    weightPercent: Math.round((t.weightPercent / total) * 10000) / 100,
  }));
}

// ─── Нормализация того, что вернул экстрактор ─────────────────────────
// Экстрактор — источник ненадёжных данных (особенно ИИ), поэтому всё, что
// он вернул, проходит через эту функцию, а не пишется в базу как есть.
function normalizeDrafts(rawItems, { program, defaults }) {
  const knownTopics = new Set((program.blueprint ?? []).map((s) => s.code));

  return rawItems
    .map((raw, index) => {
      const stem = String(raw.stem ?? "").trim();
      if (!stem) return null; // пустое условие — мусор распознавания

      const options = (Array.isArray(raw.options) ? raw.options : [])
        .map((o) => ({
          key: String(o.key ?? "").trim().slice(0, 4),
          text: String(o.text ?? "").trim().slice(0, 2000),
          explanation: "",
        }))
        .filter((o) => o.key && o.text);

      // Ключи, не соответствующие ни одному варианту, отбрасываем: чаще
      // всего это распознанный мусор вроде «Ответ: см. приложение».
      const optionKeys = new Set(options.map((o) => o.key));
      const correctKeys = (Array.isArray(raw.correctKeys) ? raw.correctKeys : [])
        .map((k) => String(k).trim().slice(0, 4))
        .filter((k) => optionKeys.has(k));

      // Тема принимается только если она есть в blueprint программы.
      const topicCode =
        raw.topicCode && knownTopics.has(raw.topicCode)
          ? raw.topicCode
          : (defaults.topicCode ?? null);

      const confidence =
        typeof raw.confidence === "number"
          ? Math.max(0, Math.min(1, raw.confidence))
          : null;

      const notes = [];
      if (String(raw.notes ?? "").trim()) notes.push(String(raw.notes).trim());
      if (options.length < 2) notes.push("Распознано меньше двух вариантов ответа");
      if (correctKeys.length === 0) notes.push("Ключ ответа не определён");

      return {
        index,
        type: "sba",
        stem: stem.slice(0, 8000),
        options,
        correctKeys,
        explanation: String(raw.explanation ?? "")
          .trim()
          .slice(0, 8000),
        topicCode,
        difficulty: defaults.difficulty ?? "medium",
        confidence,
        sourcePage:
          typeof raw.sourcePage === "number" ? raw.sourcePage : null,
        notes: notes.join("; ").slice(0, 1000) || null,
        discarded: false,
        imported: false,
        itemId: null,
      };
    })
    .filter(Boolean)
    .map((draft, index) => ({ ...draft, index })); // переиндексация после отсева
}

// ─── createJob ────────────────────────────────────────────────────────
export async function createJob(input) {
  const program = await ExamProgram.findById(input.programId)
    .select("_id blueprint")
    .lean();
  if (!program) throw new NotFoundError("Exam program");

  if (input.defaults?.topicCode) {
    const known = program.blueprint.some(
      (s) => s.code === input.defaults.topicCode,
    );
    if (!known) {
      throw new ValidationError(
        `defaults.topicCode "${input.defaults.topicCode}" is not in the program blueprint`,
      );
    }
  }

  const extractor = input.extractor ?? getActiveExtractorName();
  // Проверяем готовность экстрактора СЕЙЧАС, а не в момент запуска:
  // оператор должен узнать про отсутствующий ключ до загрузки файла.
  const impl = getExtractor(extractor);
  if (!impl.isConfigured()) {
    throw new ConflictError(`Extractor "${extractor}" is not configured`);
  }

  // Файл нужен всем экстракторам, кроме ручного: у того вопросы приходят
  // уже разобранными, и требовать mimeType значило бы заставлять оператора
  // подставлять фиктивное значение.
  if (extractor !== "manual" && !input.file?.mimeType) {
    throw new ValidationError(
      `Extractor "${extractor}" reads a file: file.mimeType is required`,
    );
  }

  const doc = await ExamImportJob.create({
    programId: input.programId,
    file: {
      key: input.file?.key ?? null,
      url: input.file?.url ?? null,
      originalName: input.file?.originalName ?? null,
      mimeType: input.file?.mimeType ?? null,
      sizeBytes: input.file?.sizeBytes ?? null,
      pageCount: input.file?.pageCount ?? null,
    },
    extractor,
    defaults: {
      lang: input.defaults?.lang ?? undefined,
      topicCode: input.defaults?.topicCode ?? null,
      difficulty: input.defaults?.difficulty ?? undefined,
      source: {
        kind: input.defaults?.source?.kind ?? "ai_generated",
        authority: input.defaults?.source?.authority ?? null,
        url: input.defaults?.source?.url ?? null,
        year: input.defaults?.source?.year ?? null,
        licenseNote: input.defaults?.source?.licenseNote ?? null,
      },
    },
    status: "pending",
    createdBy: input.actorId ?? null,
  });

  return doc.toObject();
}

// ─── runExtraction ────────────────────────────────────────────────────
// Сам прогон экстрактора. Через HTTP вызывается не напрямую, а из
// startExtraction (см. ниже) — оператор не должен держать соединение
// открытым все 3–4 минуты. Прямой вызов остаётся для очереди, скриптов и
// тестов.
//
// alreadyStarted — служебный флаг для startExtraction: она уже проверила
// задание и перевела его в extracting. Повторять переход здесь нельзя,
// иначе появляется промежуточное состояние, которое опрос клиента видит
// как чужой результат.
export async function runExtraction(
  jobId,
  { buffer, payloadItems, alreadyStarted = false } = {},
) {
  const job = await ExamImportJob.findById(jobId);
  if (!job) throw new NotFoundError("Import job");
  if (!alreadyStarted && !["pending", "failed"].includes(job.status)) {
    throw new ConflictError(
      `Job with status "${job.status}" cannot be re-extracted`,
    );
  }

  const program = await ExamProgram.findById(job.programId)
    .select("_id title blueprint languages")
    .lean();
  if (!program) throw new NotFoundError("Exam program");

  if (!alreadyStarted) {
    job.status = "extracting";
    job.startedAt = new Date();
    job.error = null;
    await job.save();
  }

  try {
    const extractor = getExtractor(job.extractor);
    const { items, usage, suggestedProgram } = await extractor.extract({
      buffer,
      payloadItems,
      mimeType: job.file.mimeType,
      // Имя файла нужно экстрактору, чтобы определить тип, когда браузер
      // прислал octet-stream или пустой MIME.
      fileName: job.file.originalName,
      program,
      defaults: job.defaults,
    });

    // Язык материала определяем по содержимому файла. В форме импорта язык —
    // это догадка оператора со значением по умолчанию "ru", и азербайджанский
    // сборник из-за неё уезжал в каталог как русский тест: фильтр по языку
    // такой тест не находил. Доверяем только значению из EXAM_LANGUAGES.
    const detectedLang = String(suggestedProgram?.lang ?? "").trim();
    if (
      EXAM_LANGUAGES.includes(detectedLang) &&
      detectedLang !== job.defaults.lang
    ) {
      logger?.info?.(
        {
          jobId: String(job._id),
          from: job.defaults.lang,
          to: detectedLang,
        },
        "import language corrected by content detection",
      );
      job.defaults.lang = detectedLang;
    }

    // Программа пустая — значит файл загрузили «просто так», и структуру
    // теста строим из него же. Это то, ради чего suggestedProgram и есть:
    // админу не нужно заранее размечать темы, чтобы начать.
    let effectiveProgram = program;
    if ((program.blueprint?.length ?? 0) === 0) {
      const blueprint = buildBlueprintFromSuggestion(suggestedProgram);
      const patch = {};

      if (blueprint) patch.blueprint = blueprint;

      // Название трогаем, только если оно осталось техническим —
      // осмысленное название, введённое админом, не перетираем.
      // Проверяем отдельно от разделов: на коротком файле модель может
      // не найти, на что делить, но название предложит вполне толковое.
      const suggestedTitle = String(suggestedProgram?.title ?? "").trim();
      if (suggestedTitle && /^(черновик импорта|импорт)/i.test(program.title)) {
        patch.title = suggestedTitle.slice(0, 300);
      }

      if (Object.keys(patch).length > 0) {
        effectiveProgram = await updateProgram(program._id, patch);
        logger?.info?.(
          {
            jobId: String(job._id),
            programId: String(program._id),
            topics: blueprint?.length ?? 0,
            renamed: Boolean(patch.title),
          },
          "program structure built from the imported file",
        );
      }
    }

    const drafts = normalizeDrafts(items, {
      program: effectiveProgram,
      defaults: job.defaults,
    });

    job.draftItems = drafts;
    job.stats.detected = drafts.length;
    job.stats.inputTokens = usage?.inputTokens ?? 0;
    job.stats.outputTokens = usage?.outputTokens ?? 0;
    job.status = "extracted";
    job.finishedAt = new Date();
    await job.save();

    logger?.info?.(
      {
        jobId: String(job._id),
        extractor: job.extractor,
        detected: drafts.length,
      },
      "exam import extraction finished",
    );

    return job.toObject();
  } catch (err) {
    // Ошибку фиксируем в задании, а не только в логах: оператор должен
    // видеть причину в интерфейсе и иметь возможность перезапустить.
    job.status = "failed";
    job.error = String(err?.message ?? err).slice(0, 2000);
    job.finishedAt = new Date();
    await job.save();
    throw err;
  }
}

// ─── startExtraction ──────────────────────────────────────────────────
// Асинхронный запуск: проверяем, что задание вообще можно запускать, и
// сразу возвращаем управление, не дожидаясь модели.
//
// Почему не синхронно, как задумывалось изначально: распознавание идёт
// 3–4 минуты, а nginx перед приложением рвёт соединение раньше. Браузер в
// этот момент показывает «Network Error» вообще без статуса — ошибку,
// сгенерированную nginx, отдают без CORS-заголовков, и прочитать её нельзя.
// Сервер при этом спокойно доводит распознавание до конца, но оператор
// видит сбой и теряет результат (так и случилось на проде: три задания
// со 101 распознанным вопросом, и все программы откачены формой).
//
// Прогресс оператор получает опросом задания: статусы pending → extracting
// → extracted/failed в модели уже есть, а причину падения runExtraction
// пишет в job.error.
//
// Зависший запуск: если процесс перезапустили посреди распознавания,
// задание навсегда осталось бы в extracting и его нельзя было бы повторить.
// Поэтому старый extracting считаем брошенным и разрешаем перезапуск.
const STALE_EXTRACTING_MS = 20 * 60 * 1000;

export async function startExtraction(jobId, { buffer, payloadItems } = {}) {
  const job = await ExamImportJob.findById(jobId).lean();
  if (!job) throw new NotFoundError("Import job");

  const startedAt = job.startedAt ? new Date(job.startedAt).getTime() : 0;
  const isStale =
    job.status === "extracting" && Date.now() - startedAt > STALE_EXTRACTING_MS;

  if (!["pending", "failed"].includes(job.status) && !isStale) {
    throw new ConflictError(
      `Job with status "${job.status}" cannot be re-extracted`,
    );
  }

  // Переход в extracting делаем здесь и только здесь — одним обновлением.
  // Если бы статус менял фоновый прогон, между ответом и его стартом
  // осталось бы окно, в котором опрос клиента видит прежний статус
  // задания и принимает его за результат этого запуска.
  const started = await ExamImportJob.findOneAndUpdate(
    { _id: jobId },
    { $set: { status: "extracting", startedAt: new Date(), error: null } },
    { new: true },
  ).lean();

  // Фоновая работа. Ошибку не пробрасываем: runExtraction уже записал её в
  // задание, а этот промис никто не ждёт — необработанный reject уронил бы
  // весь процесс.
  runExtraction(jobId, {
    buffer,
    payloadItems,
    alreadyStarted: true,
  }).catch((err) => {
    logger?.error?.(
      { jobId: String(jobId), err: String(err?.message ?? err) },
      "background extraction failed",
    );
  });

  // Отдаём уже помеченное задание, а не то, что прочитали до обновления:
  // клиент по этому статусу решает, начинать ли опрос.
  return started ?? job;
}

// ─── deleteJob ────────────────────────────────────────────────────────
// Уборка списка загрузок. Задание — журнал распознавания, а не сам контент:
// вопросы, уже перенесённые в банк, живут отдельно и удалением задания не
// затрагиваются (у них остаётся importJobId несуществующего задания — это
// осознанно, ссылка нужна для истории, а не для целостности).
//
// Пока идёт распознавание, удалять нельзя: фоновая работа допишет
// результат в никуда, и оператор решит, что она просто пропала.
export async function deleteJob(jobId) {
  const job = await ExamImportJob.findById(jobId).select("status stats").lean();
  if (!job) throw new NotFoundError("Import job");

  if (job.status === "extracting") {
    throw new ConflictError(
      "Задание сейчас распознаётся — дождитесь завершения",
    );
  }

  await ExamImportJob.deleteOne({ _id: jobId });
  return {
    deleted: true,
    id: String(jobId),
    // Отдаём оператору, сколько вопросов из этого задания уже в банке:
    // они остаются, и в интерфейсе об этом честно пишем.
    importedItems: job.stats?.imported ?? 0,
  };
}

// ─── listJobs / getJob ────────────────────────────────────────────────
export async function listJobs(filters = {}) {
  const query = {};
  if (filters.programId) query.programId = filters.programId;
  if (filters.status) query.status = filters.status;
  if (filters.createdBy) query.createdBy = filters.createdBy;

  return ExamImportJob.find(query)
    .sort({ createdAt: -1 })
    .limit(Math.min(filters.limit ?? 50, 200))
    .select("-draftItems")
    .lean();
}

export async function getJob(jobId) {
  const job = await ExamImportJob.findById(jobId).lean();
  if (!job) throw new NotFoundError("Import job");

  // Подсветка для оператора: что именно смотреть в первую очередь.
  const needsAttention = (job.draftItems ?? []).filter(
    (d) =>
      !d.discarded &&
      !d.imported &&
      ((d.confidence ?? 1) < LOW_CONFIDENCE_THRESHOLD ||
        d.correctKeys.length === 0 ||
        d.options.length < 2),
  ).length;

  return { ...job, needsAttention, lowConfidenceThreshold: LOW_CONFIDENCE_THRESHOLD };
}

// ─── updateDraft ──────────────────────────────────────────────────────
// Правка распознанного черновика оператором ДО переноса в банк вопросов.
export async function updateDraft(jobId, index, patch) {
  const job = await ExamImportJob.findById(jobId);
  if (!job) throw new NotFoundError("Import job");

  const draft = job.draftItems.find((d) => d.index === index);
  if (!draft) throw new NotFoundError("Draft item");
  if (draft.imported) {
    throw new ConflictError("Draft is already imported and cannot be edited");
  }

  const FIELDS = [
    "type",
    "stem",
    "options",
    "correctKeys",
    "explanation",
    "topicCode",
    "difficulty",
    "discarded",
  ];
  for (const field of FIELDS) {
    if (patch[field] !== undefined) draft[field] = patch[field];
  }
  // Черновик, отредактированный человеком, больше не «машинный».
  if (patch.stem !== undefined || patch.options !== undefined || patch.correctKeys !== undefined) {
    draft.confidence = 1;
  }

  job.stats.discarded = job.draftItems.filter((d) => d.discarded).length;
  await job.save();
  return job.toObject();
}

// ─── importDrafts ─────────────────────────────────────────────────────
// Перенос отобранных черновиков в банк вопросов.
//
// Все созданные вопросы получают status "draft" и ссылку importJobId.
// Опубликовать их можно только через ревью рецензентом — см.
// education-items/services/item.service.js → assertPublishable.
export async function importDrafts(jobId, { indexes = null, actorId = null }) {
  const job = await ExamImportJob.findById(jobId);
  if (!job) throw new NotFoundError("Import job");
  if (!["extracted", "imported"].includes(job.status)) {
    throw new ConflictError(
      `Job with status "${job.status}" has nothing to import`,
    );
  }

  const targets = job.draftItems.filter((d) => {
    if (d.discarded || d.imported) return false;
    if (indexes && !indexes.includes(d.index)) return false;
    return true;
  });

  if (targets.length === 0) {
    throw new ValidationError("No draft items available for import");
  }

  const created = [];
  const skipped = [];

  for (const draft of targets) {
    try {
      const item = await createItem({
        programId: job.programId,
        topicCode: draft.topicCode,
        lang: job.defaults.lang,
        type: draft.type,
        stem: draft.stem,
        options: draft.options,
        correctKeys: draft.correctKeys,
        explanation: draft.explanation,
        difficulty: draft.difficulty,
        source: {
          kind: job.defaults.source.kind,
          authority: job.defaults.source.authority,
          url: job.defaults.source.url,
          year: job.defaults.source.year,
          licenseNote: job.defaults.source.licenseNote,
        },
        importJobId: job._id,
        aiConfidence: draft.confidence,
        actorId,
      });

      // Сразу отправляем на ревью. Импортированный вопрос ПО ОПРЕДЕЛЕНИЮ
      // ждёт проверки человеком — оставлять его в "draft" значило бы, что
      // он не виден в очереди ревью и не виден учащимся, то есть нигде.
      // Публикацию это не ускоряет: из in_review наружу по-прежнему только
      // через reviewItem, а туда пускает лишь рецензент.
      await submitForReview(item._id, actorId);

      draft.imported = true;
      draft.itemId = item._id;
      created.push(String(item._id));
    } catch (err) {
      // Один кривой черновик не должен ронять весь импорт: собираем
      // причины и отдаём оператору списком.
      skipped.push({
        index: draft.index,
        reason: String(err?.message ?? err).slice(0, 300),
      });
    }
  }

  // Пересобираем производные поля программы. Ради languages: вопросы после
  // импорта лежат в in_review, до ревью статус не менялся бы, и тест до
  // самой публикации значился бы на языке из формы (по умолчанию "ru").
  if (created.length > 0) {
    await recountPublishedItems(job.programId);
  }

  job.stats.imported = job.draftItems.filter((d) => d.imported).length;
  job.stats.discarded = job.draftItems.filter((d) => d.discarded).length;
  // "imported" здесь означает «перенос выполнен», а не «всё до единого».
  // Остаток можно доимпортировать после правки.
  job.status = "imported";
  await job.save();

  logger?.info?.(
    {
      jobId: String(job._id),
      created: created.length,
      skipped: skipped.length,
    },
    "exam import drafts transferred to the item bank",
  );

  return {
    createdItemIds: created,
    createdCount: created.length,
    skipped,
    // Явное напоминание вызывающему: работа не закончена.
    note: "Импортированные вопросы созданы как черновики и требуют ревью перед публикацией",
  };
}
