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
import { planChunks } from "../extractors/chunker.js";
import { resolveFileKind } from "../extractors/fileTypes.js";
import {
  generate as generateBatch,
  GENERATION_BATCH_SIZE,
} from "../extractors/generate.extractor.js";
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

    // Режем файл на части под проход модели. Ручной экстрактор (payloadItems
    // без файла) и картинку planChunks вернёт одним куском — обычный путь.
    let plan;
    if (buffer) {
      const { kind } = resolveFileKind({
        mimeType: job.file.mimeType,
        fileName: job.file.originalName,
      });
      plan = await planChunks({
        bytes: buffer,
        kind,
        mimeType: job.file.mimeType,
        fileName: job.file.originalName,
      });
    } else {
      // null-часть = «взять payloadItems» (ручной экстрактор).
      plan = { chunks: [null], unit: "whole", size: 1 };
    }

    const chunks = plan.chunks;
    job.progress = { current: 0, total: chunks.length, failedChunks: 0 };
    await job.save();

    // Накапливаем распознанное по всем частям в один список, нормализуем и
    // индексируем один раз в конце — так индексы черновиков непрерывны, а
    // topicCode проверяется против уже достроенного blueprint.
    let effectiveProgram = program;
    const accumulated = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let langApplied = false;
    let failedChunks = 0;

    // Достраиваем структуру теста из ПЕРВОЙ успешной части: язык по тексту,
    // blueprint и осмысленное название из suggestedProgram. Пустой blueprint
    // — сигнал, что делаем это впервые; со второй части уже не трогаем.
    const applyFirstChunkStructure = async (suggestedProgram) => {
      if (!langApplied) {
        const detectedLang = String(suggestedProgram?.lang ?? "").trim();
        if (
          EXAM_LANGUAGES.includes(detectedLang) &&
          detectedLang !== job.defaults.lang
        ) {
          logger?.info?.(
            { jobId: String(job._id), from: job.defaults.lang, to: detectedLang },
            "import language corrected by content detection",
          );
          job.defaults.lang = detectedLang;
        }
        langApplied = true;
      }

      if ((effectiveProgram.blueprint?.length ?? 0) === 0) {
        const blueprint = buildBlueprintFromSuggestion(suggestedProgram);
        const patch = {};
        if (blueprint) patch.blueprint = blueprint;

        const suggestedTitle = String(suggestedProgram?.title ?? "").trim();
        if (
          suggestedTitle &&
          /^(черновик импорта|импорт)/i.test(effectiveProgram.title)
        ) {
          patch.title = suggestedTitle.slice(0, 300);
        }

        if (Object.keys(patch).length > 0) {
          effectiveProgram = await updateProgram(effectiveProgram._id, patch);
          logger?.info?.(
            {
              jobId: String(job._id),
              programId: String(effectiveProgram._id),
              topics: blueprint?.length ?? 0,
              renamed: Boolean(patch.title),
            },
            "program structure built from the imported file",
          );
        }
      }
    };

    // Прогон одной части. Если модель не уместила её вывод в лимит (overflow),
    // делим часть пополам и повторяем — до depth-предела. Так оператору не
    // нужно самому угадывать, на сколько страниц бить файл.
    const runChunk = async (chunk, depth = 0) => {
      const extractArgs = chunk
        ? await chunk.build()
        : { payloadItems };

      let result;
      try {
        result = await extractor.extract({
          ...extractArgs,
          mimeType: extractArgs.mimeType ?? job.file.mimeType,
          fileName: extractArgs.fileName ?? job.file.originalName,
          program: effectiveProgram,
          defaults: job.defaults,
        });
      } catch (err) {
        if (err?.details?.overflow && chunk && depth < 4) {
          const halves = chunk.subdivide();
          if (halves) {
            // Логируем: деление молча — это минуты лишней работы на плотных
            // частях, и без записи в мониторинге такой файл выглядит
            // «зависшим». Видя переполнения, размер части можно подстроить.
            logger?.info?.(
              {
                jobId: String(job._id),
                chunk: chunk.label,
                depth,
                into: halves.length,
              },
              "chunk overflowed output limit, splitting",
            );
            const items = [];
            for (const half of halves) {
              items.push(...(await runChunk(half, depth + 1)));
            }
            return items;
          }
        }
        throw err;
      }

      await applyFirstChunkStructure(result.suggestedProgram);
      inputTokens += result.usage?.inputTokens ?? 0;
      outputTokens += result.usage?.outputTokens ?? 0;
      return Array.isArray(result.items) ? result.items : [];
    };

    let cancelled = false;
    for (let i = 0; i < chunks.length; i += 1) {
      // Отмена приходит из другого запроса (cancelJob помечает задание в
      // базе), а этот прогон держит свою копию job в памяти и о правке не
      // знает — поэтому перед каждой частью перечитываем статус. Прервать
      // на середине части нельзя (вызов модели уже идёт), но между частями
      // — точка выхода, и накопленное не теряется.
      const fresh = await ExamImportJob.findById(job._id)
        .select("status")
        .lean();
      if (fresh?.status === "cancelled") {
        cancelled = true;
        break;
      }

      // Прогресс пишем точечно, а не job.save(): полный save затёр бы
      // статус cancelled, если отмена пришла между итерациями.
      await ExamImportJob.updateOne(
        { _id: job._id },
        { $set: { "progress.current": i + 1 } },
      );

      try {
        accumulated.push(...(await runChunk(chunks[i])));
      } catch (err) {
        // Одна сорвавшаяся часть не должна ронять весь импорт: остальные
        // доводим и переносим. Терять 11 частей из-за одной нельзя.
        failedChunks += 1;
        logger?.warn?.(
          {
            jobId: String(job._id),
            chunk: i + 1,
            of: chunks.length,
            err: String(err?.message ?? err),
          },
          "chunk extraction failed",
        );
      }
    }

    const drafts = normalizeDrafts(accumulated, {
      program: effectiveProgram,
      defaults: job.defaults,
    });

    // Остановлено оператором: сохраняем то, что успели распознать — эти
    // вопросы не выбрасываем, оператор сам решит, нужны ли они. Статус
    // остаётся cancelled, минуя обычные extracted/failed.
    if (cancelled) {
      await ExamImportJob.updateOne(
        { _id: job._id },
        {
          $set: {
            draftItems: drafts,
            "stats.detected": drafts.length,
            "stats.inputTokens": inputTokens,
            "stats.outputTokens": outputTokens,
            "progress.failedChunks": failedChunks,
            status: "cancelled",
            error: `Распознавание остановлено. Успело распознаться ${drafts.length} вопросов — их можно проверить и перенести или удалить задание.`,
            finishedAt: new Date(),
          },
        },
      );
      logger?.info?.(
        { jobId: String(job._id), detected: drafts.length },
        "exam import extraction cancelled by operator",
      );
      const doc = await ExamImportJob.findById(job._id);
      return doc.toObject();
    }

    job.draftItems = drafts;
    job.stats.detected = drafts.length;
    job.stats.inputTokens = inputTokens;
    job.stats.outputTokens = outputTokens;
    // Прогресс в цикле обновлялся через updateOne, локальная копия отстала —
    // выставляем на «все части пройдены», иначе финальный save вернёт старое.
    job.progress.current = chunks.length;
    job.progress.failedChunks = failedChunks;

    // Все части провалились и распознавать нечего — это неудача, а не
    // «пустой успех»: пустое задание молча выглядело бы как «нет вопросов».
    if (drafts.length === 0 && failedChunks === chunks.length) {
      job.status = "failed";
      job.error =
        "Ни одна часть файла не распозналась. Проверьте, что это читаемый " +
        "текст или скан с вопросами, а не пустой документ.";
    } else {
      job.status = "extracted";
      job.error = failedChunks
        ? `Распозналось частей: ${chunks.length - failedChunks} из ${chunks.length}. ` +
          `Часть материала могла не попасть в разбор.`
        : null;
    }
    job.finishedAt = new Date();
    await job.save();

    logger?.info?.(
      {
        jobId: String(job._id),
        extractor: job.extractor,
        chunks: chunks.length,
        failedChunks,
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

// ─── Генерация вопросов моделью ───────────────────────────────────────
// Тот же конвейер, что и импорт: результат ложится в draftItems задания,
// оператор смотрит его в том же экране и переносит в банк. Разница только
// в источнике — не файл, а тема, — поэтому «части» здесь это батчи, а не
// куски документа.
//
// Крупный заказ бьём на батчи не из-за лимита (хотя и он есть), а ради
// качества: на коротком батче модель тщательнее и меньше повторяется.
const MAX_GENERATION_COUNT = 500;

// Ниже этого размера батч не ужимаем: если и три вопроса не помещаются в
// ответ, дело не в объёме заказа, и повторять бессмысленно.
const MIN_GENERATION_BATCH = 3;

export async function runGeneration(jobId, { alreadyStarted = false } = {}) {
  const job = await ExamImportJob.findById(jobId);
  if (!job) throw new NotFoundError("Import job");
  if (!alreadyStarted && !["pending", "failed"].includes(job.status)) {
    throw new ConflictError(
      `Job with status "${job.status}" cannot be re-run`,
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

  const spec = job.generationSpec ?? {};
  const total = Math.max(1, Math.min(spec.count ?? 0, MAX_GENERATION_COUNT));
  const batches = Math.ceil(total / GENERATION_BATCH_SIZE);

  try {
    job.progress = { current: 0, total: batches, failedChunks: 0 };
    await job.save();

    let effectiveProgram = program;
    const accumulated = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let failedBatches = 0;
    // Причина последнего провалившегося батча. Без неё оператор видел
    // только «модель ничего не сгенерировала», а настоящая ошибка (ключ,
    // 429, отказ модели) оставалась в логе PM2 — искать её было негде.
    let lastBatchError = null;

    // На первом успешном батче строим структуру теста из предложения модели,
    // как и импорт. Язык здесь известен заранее (его выбрал оператор), но
    // название и разделы всё равно берём из suggestedProgram.
    const applyFirstBatchStructure = async (suggestedProgram) => {
      if ((effectiveProgram.blueprint?.length ?? 0) === 0) {
        const blueprint = buildBlueprintFromSuggestion(suggestedProgram);
        const patch = {};
        if (blueprint) patch.blueprint = blueprint;
        const suggestedTitle = String(suggestedProgram?.title ?? "").trim();
        if (
          suggestedTitle &&
          /^(черновик генерации|генерация|черновик импорта)/i.test(
            effectiveProgram.title,
          )
        ) {
          patch.title = suggestedTitle.slice(0, 300);
        }
        if (Object.keys(patch).length > 0) {
          effectiveProgram = await updateProgram(effectiveProgram._id, patch);
        }
      }
    };

    for (let i = 0; i < batches; i += 1) {
      job.progress.current = i + 1;
      await job.save();

      const remaining = total - accumulated.length;
      let batchCount = Math.min(GENERATION_BATCH_SIZE, remaining);
      if (batchCount <= 0) break;

      // Переполнение ответа (stop_reason: max_tokens) экстрактор помечает
      // флагом overflow — это не отказ, а слишком крупный заказ на один
      // вызов. Уменьшаем батч вдвое и повторяем тот же кусок, вместо того
      // чтобы записать его в потери: на длинных медицинских вопросах с
      // разбором 20 штук за раз в лимит вывода не влезают.
      for (;;) {
        try {
          const result = await generateBatch({
            topic: spec.topic,
            count: batchCount,
            lang: job.defaults.lang,
            difficulty: spec.difficulty ?? "mixed",
            program: effectiveProgram,
            // Не повторять уже созданное: передаём тексты накопленных вопросов.
            avoidStems: accumulated.map((it) => it.stem),
          });
          await applyFirstBatchStructure(result.suggestedProgram);
          inputTokens += result.usage?.inputTokens ?? 0;
          outputTokens += result.usage?.outputTokens ?? 0;
          accumulated.push(...result.items);
          break;
        } catch (err) {
          if (err?.details?.overflow && batchCount > MIN_GENERATION_BATCH) {
            const smaller = Math.max(
              MIN_GENERATION_BATCH,
              Math.floor(batchCount / 2),
            );
            logger?.warn?.(
              {
                jobId: String(job._id),
                batch: i + 1,
                from: batchCount,
                to: smaller,
              },
              "generation batch overflowed, retrying smaller",
            );
            batchCount = smaller;
            continue;
          }

          failedBatches += 1;
          lastBatchError = String(err?.message ?? err);
          logger?.warn?.(
            {
              jobId: String(job._id),
              batch: i + 1,
              of: batches,
              err: lastBatchError,
            },
            "generation batch failed",
          );
          break;
        }
      }
    }

    const drafts = normalizeDrafts(accumulated, {
      program: effectiveProgram,
      defaults: job.defaults,
    });

    job.draftItems = drafts;
    job.stats.detected = drafts.length;
    job.stats.inputTokens = inputTokens;
    job.stats.outputTokens = outputTokens;
    job.progress.failedChunks = failedBatches;

    if (drafts.length === 0) {
      job.status = "failed";
      // Настоящую причину показываем оператору: «уточните тему» уводит не
      // туда, если на самом деле отвергнут ключ или сработал лимит.
      job.error = lastBatchError
        ? `Не удалось сгенерировать вопросы. Причина: ${lastBatchError}`.slice(
            0,
            2000,
          )
        : "Модель не сгенерировала ни одного вопроса. Уточните тему и повторите.";
    } else {
      job.status = "extracted";
      job.error =
        failedBatches && drafts.length < total
          ? `Сгенерировано ${drafts.length} из ${total}: часть батчей не удалась, ` +
            `можно догенерировать в этот же тест.`
          : null;
    }
    job.finishedAt = new Date();
    await job.save();

    logger?.info?.(
      {
        jobId: String(job._id),
        topic: spec.topic,
        requested: total,
        generated: drafts.length,
        failedBatches,
      },
      "exam question generation finished",
    );

    return job.toObject();
  } catch (err) {
    job.status = "failed";
    job.error = String(err?.message ?? err).slice(0, 2000);
    job.finishedAt = new Date();
    await job.save();
    throw err;
  }
}

// Асинхронный запуск генерации — тот же приём, что startExtraction: сразу
// метим extracting и возвращаем управление, работа идёт в фоне.
export async function startGeneration(jobId) {
  const started = await ExamImportJob.findOneAndUpdate(
    { _id: jobId, status: { $in: ["pending", "failed"] } },
    { $set: { status: "extracting", startedAt: new Date(), error: null } },
    { new: true },
  ).lean();
  if (!started) {
    throw new ConflictError("Задание нельзя запустить в текущем статусе");
  }

  runGeneration(jobId, { alreadyStarted: true }).catch((err) => {
    logger?.error?.(
      { jobId: String(jobId), err: String(err?.message ?? err) },
      "background generation failed",
    );
  });

  return started;
}

// Создать задание генерации и сразу запустить его в фоне.
export async function createGenerationJob({
  programId,
  topic,
  count,
  lang,
  difficulty,
  sourceNote,
  actorId,
}) {
  const cleanTopic = String(topic ?? "").trim();
  if (!cleanTopic) throw new ValidationError("Укажите тему для генерации");
  const n = Number(count);
  if (!Number.isInteger(n) || n < 1) {
    throw new ValidationError("Число вопросов должно быть целым и больше нуля");
  }
  if (n > MAX_GENERATION_COUNT) {
    throw new ValidationError(
      `За один заказ можно сгенерировать не больше ${MAX_GENERATION_COUNT} вопросов. ` +
        `Для большего объёма запустите генерацию ещё раз в тот же тест.`,
    );
  }

  const job = await ExamImportJob.create({
    programId,
    extractor: "generate",
    // Файла нет — генерация не из документа. Имя для списка задаём по теме.
    file: { originalName: `Генерация: ${cleanTopic}`.slice(0, 300) },
    generationSpec: { topic: cleanTopic, count: n, difficulty: difficulty ?? "mixed" },
    defaults: {
      lang: lang ?? "ru",
      source: {
        // Происхождение — машинное: гейт ревью обязателен.
        kind: "ai_generated",
        // Заметка о происхождении, если оператор указал (например, «по
        // мотивам открытого банка X»). В orган/лицензию не пишем: это не
        // заимствование, а авторская генерация.
        licenseNote: sourceNote ? String(sourceNote).slice(0, 2000) : null,
      },
    },
    status: "pending",
    createdBy: actorId ?? null,
  });

  return startGeneration(job._id);
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

// ─── cancelJob ────────────────────────────────────────────────────────
// Останавливает идущее распознавание по кнопке оператора.
//
// Сам фоновый прогон в Node не прервать на полуслове — вызов модели уже
// летит. Поэтому отмена — это флаг в базе: цикл runExtraction перечитывает
// статус перед каждой частью и выходит, увидев cancelled, сохранив всё,
// что успел распознать. Между частями пауза невелика, так что реакция на
// кнопку — секунды, а не минуты.
export async function cancelJob(jobId) {
  const job = await ExamImportJob.findById(jobId).select("status").lean();
  if (!job) throw new NotFoundError("Import job");

  // Отменять есть смысл только то, что ещё в работе.
  if (job.status !== "extracting" && job.status !== "pending") {
    throw new ConflictError(
      `Задание в статусе «${job.status}» уже не выполняется — отменять нечего`,
    );
  }

  // pending мог ещё не начать прогон (файла нет / не запущен) — тогда цикл
  // его не подхватит, но статус всё равно ставим: задание больше не висит.
  await ExamImportJob.updateOne(
    { _id: jobId },
    {
      $set: {
        status: "cancelled",
        error: "Распознавание остановлено оператором.",
        finishedAt: new Date(),
      },
    },
  );

  return { cancelled: true, id: String(jobId) };
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
