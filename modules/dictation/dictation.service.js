// server/modules/dictation/dictation.service.js
//
// Жизненный цикл надиктовки: приём аудио → распознавание → сборка структуры
// → правка врачом → черновик в карте.
//
// ГДЕ ПРОХОДИТ ГРАНИЦА ОТВЕТСТВЕННОСТИ. Сервис доводит дело до ЧЕРНОВИКА и
// останавливается. Черновик не виден пациенту, не считается медицинским
// документом и ничего не утверждает. Врач правит его и подписывает обычным
// путём модуля — подпись остаётся человеческим действием, и это не
// формальность интерфейса, а то, что делает запись юридически чьей-то.
//
// ПОЧЕМУ ВЛАДЕЛЕЦ ПРОВЕРЯЕТСЯ В КАЖДОЙ ФУНКЦИИ. myClinic — модуль одного
// врача, и задание принадлежит тому, кто его создал. Проверка стоит в
// сервисе, а не в контроллере: новый маршрут не сможет её обойти. Тот же
// приём, что в diagnostics с его двойным подтверждением.

import mongoose from "mongoose";
import DictationJob, { MAX_ATTEMPTS, EXPIRE_AFTER_DAYS } from "./dictation.model.js";
import { getSink, hasSink } from "./sinks/index.js";
import * as sttProvider from "./providers/stt.provider.js";
import * as structureProvider from "./providers/structure.provider.js";
import { fetchAudio } from "./providers/audio.store.js";
import { enrichDraftWithCodes } from "./services/codeSuggest.service.js";
import { uploadFile, deleteFile } from "../../common/middlewares/uploadMiddleware.js";
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from "../../common/utils/errors.js";
import logger from "../../common/logger.js";

const DAY_MS = 86400000;

// Поля черновика, которые врач может править до прикрепления. Список закрытый:
// иначе через правку можно было бы подменить владельца задания или пациента.
export const EDITABLE_DRAFT_FIELDS = [
  "complaints",
  "anamnesisMorbi",
  "anamnesisVitae",
  "statusPreasens",
  "statusLocalis",
  "mainDiagnosisText",
  "mainDiagnosisCode",
  "recommendations",
  "ctScanResults",
  "mriResults",
  "ultrasoundResults",
  "laboratoryTestResults",
];

const EMPTY_DRAFT = Object.freeze(
  Object.fromEntries(EDITABLE_DRAFT_FIELDS.map((f) => [f, null])),
);

/** Разбор сохранённого черновика. Битый JSON не должен ронять чтение задания. */
export function parseDraft(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Оставляет только разрешённые поля и приводит пустое к null. */
/**
 * Поля, которые НЕ диктует врач и НЕ правит руками: их выводит система.
 *
 * Отделены от EDITABLE_DRAFT_FIELDS намеренно. Официальное название кода
 * приходит из справочника МКБ, а не из речи, и принимать его в PATCH от
 * клиента нельзя: тогда через правку черновика можно было бы подставить к
 * коду произвольное «официальное» название. По той же причине их не может
 * прислать браузер — они переживают правку, но приходят только изнутри.
 */
export const DERIVED_DRAFT_FIELDS = [
  "mainDiagnosisCodeTitle", // официальное название кода из справочника
  "mainDiagnosisCodeUnknown", // код назван, но в справочнике не найден
  "codeSuggestions", // кандидаты для выбора врачом
];

/**
 * @param {object} input
 * @param {object} [options]
 * @param {boolean} [options.keepDerived] сохранить служебные поля из input.
 *   Ставится ТОЛЬКО внутренним кодом (после структурирования и при правке,
 *   чтобы подсказки не терялись), но никогда — для данных, пришедших от
 *   клиента напрямую.
 */
export function sanitizeDraft(input, { keepDerived = false } = {}) {
  const out = { ...EMPTY_DRAFT };
  for (const field of EDITABLE_DRAFT_FIELDS) {
    const value = input?.[field];
    if (value == null) continue;
    const text = String(value).trim();
    out[field] = text ? text.slice(0, 8000) : null;
  }

  if (keepDerived) {
    if (input?.mainDiagnosisCodeTitle) {
      out.mainDiagnosisCodeTitle = String(input.mainDiagnosisCodeTitle)
        .trim()
        .slice(0, 500);
    }
    if (input?.mainDiagnosisCodeUnknown) {
      out.mainDiagnosisCodeUnknown = true;
    }
    if (Array.isArray(input?.codeSuggestions)) {
      out.codeSuggestions = input.codeSuggestions
        .slice(0, 5)
        .map((item) => ({
          code: String(item?.code || "").slice(0, 20),
          title: String(item?.title || "").slice(0, 500),
          titleEn: String(item?.titleEn || "").slice(0, 500),
        }))
        .filter((item) => item.code);
    }
  }

  return out;
}

/** Задание врача с проверкой владельца. Чужое задание — «не найдено». */
async function loadOwned(jobId, doctorId) {
  if (!mongoose.isValidObjectId(jobId)) throw new NotFoundError("Dictation job");
  const job = await DictationJob.findById(jobId);
  if (!job) throw new NotFoundError("Dictation job");
  if (String(job.doctorId) !== String(doctorId)) {
    // Намеренно ForbiddenError, а не NotFound: врач и пациент здесь свои,
    // скрывать факт существования задания не от кого, а внятная ошибка
    // экономит время при разборе.
    throw new ForbiddenError("Это задание принадлежит другому врачу", { i18n: "app.dictation.taskOwnedByAnotherDoctor" });
  }
  return job;
}

/**
 * Приём аудио. Файл уходит в хранилище, задание встаёт в очередь воркера.
 *
 * @param {object} args
 * @param {object} args.file        multer-файл (buffer, originalname, mimetype)
 * @param {string} args.doctorId
 * @param {object} args.patient     { patientType, patientRef, patientTypeModel }
 * @param {string} [args.lang]
 * @param {string} [args.sink]
 */
export async function createJob({ file, doctorId, patient, lang = "", sink = "myClinic" }) {
  if (!file?.buffer?.length) throw new ValidationError("Аудиофайл не передан", { i18n: "app.dictation.audioMissing" });
  if (!hasSink(sink)) throw new ValidationError(`Неизвестный приёмник: ${sink}`);
  if (!patient?.patientRef || !patient?.patientType || !patient?.patientTypeModel) {
    throw new ValidationError("Не определён пациент для надиктовки", { i18n: "app.dictation.patientNotResolved" });
  }

  const audioUrl = await uploadFile(file);

  const job = await DictationJob.create({
    doctorId,
    patientType: patient.patientType,
    patientRef: patient.patientRef,
    patientTypeModel: patient.patientTypeModel,
    sink,
    audioUrl,
    lang: String(lang || "").trim().slice(0, 10),
    status: "uploaded",
  });

  return job;
}

/**
 * Один шаг обработки: берёт ОДНО задание и двигает его на стадию вперёд.
 *
 * findOneAndUpdate вместо find+save — атомарный захват. Без него два воркера
 * (или один после рестарта) взяли бы одно задание дважды и заплатили бы за
 * распознавание двойную цену.
 *
 * @returns {Promise<{picked: boolean, jobId?: string, stage?: string, ok?: boolean}>}
 */
export async function processNext() {
  // 1. Распознавание.
  const toTranscribe = await DictationJob.findOneAndUpdate(
    { status: "uploaded", attempts: { $lt: MAX_ATTEMPTS } },
    { $set: { status: "transcribing" }, $inc: { attempts: 1 } },
    { sort: { createdAt: 1 }, new: true },
  );
  if (toTranscribe) return runTranscribe(toTranscribe);

  // 2. Сборка структуры. Счётчик попыток общий на всё задание: три неудачи
  // любой природы — и задание уходит человеку, а не крутится вечно.
  const toStructure = await DictationJob.findOneAndUpdate(
    { status: "transcribed", attempts: { $lt: MAX_ATTEMPTS } },
    { $set: { status: "structuring" }, $inc: { attempts: 1 } },
    { sort: { createdAt: 1 }, new: true },
  );
  if (toStructure) return runStructure(toStructure);

  return { picked: false };
}

/**
 * Расширение записи из её URL.
 *
 * Распознаватель определяет формат по имени файла, а формат зависит от
 * браузера: Chrome отдаёт webm, Safari на iOS — mp4. Жёстко зашитый ".webm"
 * означал бы, что надиктовки с айфона не распознаются вовсе. Хранилище
 * сохраняет расширение в ключе (uploadFile), поэтому берём его оттуда.
 */
function audioExt(url) {
  const m = /\.([a-z0-9]{2,4})(?:\?|$)/i.exec(String(url ?? ""));
  return m ? m[1].toLowerCase() : "webm";
}

async function runTranscribe(job) {
  try {
    const buffer = await fetchAudio(job.audioUrl);
    const { text, model, durationSec } = await sttProvider.transcribe({
      buffer,
      filename: `dictation-${job._id}.${audioExt(job.audioUrl)}`,
      lang: job.lang || undefined,
    });

    job.transcript = text;
    job.sttModel = model;
    job.durationSec = durationSec;
    job.status = "transcribed";
    job.lastError = null;
    await job.save();
    return { picked: true, jobId: String(job._id), stage: "transcribe", ok: true };
  } catch (err) {
    await failStage(job, "uploaded", err);
    return { picked: true, jobId: String(job._id), stage: "transcribe", ok: false };
  }
}

async function runStructure(job) {
  try {
    // Геттер расшифровывает PHI при чтении — модели уходит открытый текст.
    const { draft, model } = await structureProvider.structure({
      transcript: job.transcript,
    });

    // Подсказки кодов МКБ. Ничего не проставляют сами: подставляют официальное
    // название к коду, который назвал врач, и предлагают кандидатов, если код
    // не прозвучал. Выбор остаётся за врачом.
    //
    // Служебное поле mainDiagnosisTermEn (английский термин для поиска) в
    // черновик не попадает: sanitizeDraft его отбрасывает, и это правильно —
    // врачу оно ни к чему, а нужно было только для запроса в справочник.
    const enriched = await enrichDraftWithCodes(draft, job.lang || "ru");

    job.draftJson = JSON.stringify(sanitizeDraft(enriched, { keepDerived: true }));
    job.structureModel = model;
    job.status = "drafted";
    job.lastError = null;
    await job.save();
    return { picked: true, jobId: String(job._id), stage: "structure", ok: true };
  } catch (err) {
    await failStage(job, "transcribed", err);
    return { picked: true, jobId: String(job._id), stage: "structure", ok: false };
  }
}

/**
 * Стоит ли повторять стадию.
 *
 * Повторяем только то, что могло пройти в следующий раз: недоступность
 * сервиса, таймаут, 429, 5xx. Отказ по существу («в записи не распознана
 * речь», «файл не того формата», «модель отклонила текст») повторять
 * бессмысленно — три попытки дадут тот же результат за тройную цену, а врач
 * всё это время будет ждать черновик, которого не будет.
 *
 * Провайдеры уже делают это различение: временное они бросают как
 * ServiceUnavailableError, окончательное — как ValidationError.
 */
function isRetryable(err) {
  if (err instanceof ValidationError) return false;
  const status = Number(err?.statusCode ?? err?.status ?? 0);
  if (status === 429) return true;
  // 4xx — наша вина и повтором не лечится. 0 (сеть оборвалась) и 5xx — лечится.
  if (status >= 400 && status < 500) return false;
  return true;
}

/**
 * Возврат задания на предыдущую стадию либо признание провала.
 * Ошибка сохраняется текстом: врач должен видеть, почему не получилось,
 * а не «что-то пошло не так».
 */
async function failStage(job, backTo, err) {
  const message = String(err?.message ?? err).slice(0, 2000);
  job.lastError = message;
  const giveUp = !isRetryable(err) || job.attempts >= MAX_ATTEMPTS;
  job.status = giveUp ? "failed" : backTo;
  await job.save();
  logger?.warn?.(
    { jobId: String(job._id), attempts: job.attempts, status: job.status },
    `dictation: стадия не прошла — ${message}`,
  );
}

/** Задание врача в виде, пригодном для интерфейса. */
export async function getJob(jobId, doctorId) {
  const job = await loadOwned(jobId, doctorId);
  return presentJob(job);
}

/** Список последних заданий врача. Без расшифровок — они тяжёлые. */
export async function listJobs(doctorId, { limit = 20 } = {}) {
  const docs = await DictationJob.find({ doctorId })
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(Number(limit) || 20, 1), 100));
  return docs.map((d) => ({
    id: String(d._id),
    status: d.status,
    durationSec: d.durationSec,
    lastError: d.lastError,
    medicalHistoryId: d.medicalHistoryId ? String(d.medicalHistoryId) : null,
    createdAt: d.createdAt,
  }));
}

export function presentJob(job) {
  return {
    id: String(job._id),
    status: job.status,
    // Расшифровка отдаётся врачу рядом с формой: он должен видеть источник
    // каждой строки черновика, иначе проверить нечего.
    transcript: job.transcript || "",
    draft: parseDraft(job.draftJson),
    durationSec: job.durationSec,
    lang: job.lang,
    attempts: job.attempts,
    lastError: job.lastError,
    sttModel: job.sttModel,
    structureModel: job.structureModel,
    medicalHistoryId: job.medicalHistoryId ? String(job.medicalHistoryId) : null,
    createdAt: job.createdAt,
  };
}

/** Правка черновика врачом до прикрепления. */
export async function updateDraft(jobId, doctorId, patch) {
  const job = await loadOwned(jobId, doctorId);
  if (job.status !== "drafted") {
    throw new ConflictError(
      `Черновик можно править только в статусе "drafted" (сейчас "${job.status}")`,
    );
  }
  const current = parseDraft(job.draftJson) ?? { ...EMPTY_DRAFT };

  // Правка врача накладывается только на редактируемые поля. Служебные
  // (название кода из справочника, подсказки) берутся из ТЕКУЩЕГО черновика,
  // а не из присланного патча: иначе через правку можно было бы подставить к
  // коду произвольное «официальное» название.
  const merged = { ...current, ...patch };
  const derived = {
    mainDiagnosisCodeTitle: current.mainDiagnosisCodeTitle,
    mainDiagnosisCodeUnknown: current.mainDiagnosisCodeUnknown,
    codeSuggestions: current.codeSuggestions,
  };

  // Врач сменил код руками (или выбрал из подсказок) — прежнее название
  // относилось к прежнему коду, и оставлять его нельзя: в карту ушла бы пара
  // «новый код + чужое официальное название». Спрашиваем справочник заново.
  const codeChanged =
    (merged.mainDiagnosisCode ?? null) !== (current.mainDiagnosisCode ?? null);

  const next = codeChanged
    ? await enrichDraftWithCodes(
        { ...merged, mainDiagnosisCodeTitle: null, mainDiagnosisCodeUnknown: null },
        job.lang || "ru",
      )
    : { ...merged, ...derived };

  job.draftJson = JSON.stringify(sanitizeDraft(next, { keepDerived: true }));
  await job.save();
  return presentJob(job);
}

/**
 * Прикрепление: черновик уходит в карту, аудио удаляется.
 *
 * ПОРЯДОК ВАЖЕН. Аудио стирается ПОСЛЕ создания записи, а не после
 * распознавания: врач, усомнившийся в формулировке, должен иметь возможность
 * переслушать. После того как запись в карте есть, голос бесполезен — а
 * хранить его дальше значит держать биометрию без причины.
 */
export async function attachJob(jobId, doctorId) {
  const job = await loadOwned(jobId, doctorId);
  if (job.status !== "drafted") {
    throw new ConflictError(
      `Прикрепить можно только готовый черновик (сейчас "${job.status}")`,
    );
  }
  const draft = parseDraft(job.draftJson);
  if (!draft) throw new ConflictError("У задания нет черновика", { i18n: "app.dictation.noDraft" });

  const sink = getSink(job.sink);
  if (!sink) throw new ConflictError(`Приёмник "${job.sink}" недоступен`);

  const record = await sink.attach({ draft, job });

  job.medicalHistoryId = record._id;
  job.status = "attached";
  job.attachedAt = new Date();
  await job.save();

  await purgeAudio(job);

  return { job: presentJob(job), medicalHistoryId: String(record._id) };
}

/** Отказ от задания: аудио стирается сразу, расшифровка остаётся следом. */
export async function discardJob(jobId, doctorId) {
  const job = await loadOwned(jobId, doctorId);
  if (job.status === "attached") {
    throw new ConflictError("Задание уже прикреплено к карте — отказаться нельзя", { i18n: "app.dictation.alreadyAttached" });
  }
  job.status = "expired";
  await job.save();
  await purgeAudio(job);
  return { discarded: true, id: String(job._id) };
}

/** Удаление аудио. Идемпотентно: повторный вызов ничего не ломает. */
export async function purgeAudio(job) {
  if (!job.audioUrl) return false;
  try {
    await deleteFile(job.audioUrl);
  } catch (err) {
    // Не срываем основной путь: запись в карте важнее, чем немедленная
    // уборка файла. Не удалённое подберёт ретеншн следующим проходом.
    logger?.warn?.(
      { jobId: String(job._id), err },
      "dictation: не удалось удалить аудио",
    );
    return false;
  }
  job.audioUrl = null;
  job.audioDeletedAt = new Date();
  await job.save();
  return true;
}

/**
 * Возврат зависших заданий в очередь.
 *
 * ЗАЧЕМ. Воркер захватывает задание, переводя его в промежуточный статус
 * (transcribing / structuring). Если процесс в этот момент упадёт — рестарт,
 * OOM, потеря соединения с базой, — задание останется в этом статусе навсегда:
 * ни один запрос очереди его не выбирает. Врач будет ждать черновик, которого
 * никто не делает, и узнает об этом только пожаловавшись.
 *
 * Счётчик попыток при возврате НЕ сбрасывается: задание, которое вешает
 * воркер раз за разом, должно в итоге признаться неудачным, а не крутиться
 * вечно.
 *
 * @param {object} [opts]
 * @param {number} [opts.olderThanMs] сколько ждать, прежде чем счесть зависшим
 */
export async function reclaimStale({ olderThanMs = 10 * 60 * 1000 } = {}) {
  const cutoff = new Date(Date.now() - olderThanMs);
  // Пара «промежуточный статус → куда вернуть».
  const STAGES = [
    ["transcribing", "uploaded"],
    ["structuring", "transcribed"],
  ];

  let reclaimed = 0;
  for (const [inFlight, backTo] of STAGES) {
    const res = await DictationJob.updateMany(
      { status: inFlight, updatedAt: { $lt: cutoff } },
      { $set: { status: backTo, lastError: "Обработка прервана, задание возвращено в очередь" } },
    );
    reclaimed += res.modifiedCount ?? 0;
  }
  if (reclaimed) {
    logger?.warn?.({ reclaimed }, "dictation: зависшие задания возвращены в очередь");
  }
  return { reclaimed };
}

/**
 * Ретеншн. Гоняется по расписанию:
 *   1. прикреплённые и брошенные — стереть аудио, если ещё лежит;
 *   2. неразобранные старше недели — пометить протухшими и стереть аудио;
 *   3. расшифровки заданий, которые так и не дошли до карты, — стереть.
 *
 * Про расшифровки различаем два случая. У ПРИКРЕПЛЁННОГО задания расшифровка
 * остаётся: она однажды ответит на вопрос «откуда в карте эта фраза». У
 * ОТБРОШЕННОГО отвечать нечего — записи в карте нет, — и текст приёма лежал бы
 * без назначения. Держать PHI, которое ничего не объясняет, незачем.
 */
export async function runRetention({ now = new Date() } = {}) {
  const result = { purged: 0, expired: 0, scrubbed: 0 };

  const stale = await DictationJob.find({
    status: { $in: ["attached", "expired", "failed"] },
    audioUrl: { $ne: null },
  }).limit(200);
  for (const job of stale) {
    if (await purgeAudio(job)) result.purged += 1;
  }

  const cutoff = new Date(now.getTime() - EXPIRE_AFTER_DAYS * DAY_MS);
  const abandoned = await DictationJob.find({
    status: { $in: ["uploaded", "transcribing", "transcribed", "structuring", "drafted"] },
    createdAt: { $lt: cutoff },
  }).limit(200);
  for (const job of abandoned) {
    job.status = "expired";
    await job.save();
    if (await purgeAudio(job)) result.purged += 1;
    result.expired += 1;
  }

  // Расшифровки заданий, не дошедших до карты. Срок тот же, что у аудио:
  // после него врач к этой надиктовке уже не вернётся.
  const dead = await DictationJob.find({
    status: { $in: ["expired", "failed"] },
    updatedAt: { $lt: cutoff },
    $or: [{ transcript: { $nin: [null, ""] } }, { draftJson: { $nin: [null, ""] } }],
  }).limit(200);
  for (const job of dead) {
    job.transcript = null;
    job.draftJson = null;
    await job.save();
    result.scrubbed += 1;
  }

  return result;
}
