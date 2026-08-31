// server/modules/diagnostics/core/services/analysis.service.js
//
// ЗАПУСК АНАЛИЗА: гейты → задания → анализатор → выводы → происхождение.
//
// Порядок гейтов важен и намеренно жёсткий. Материал живого пациента уходит
// внешней модели, поэтому запуск невозможен, пока врач не подтвердил ДВЕ
// разные вещи:
//   deidentified — материалы обезличены (нет ФИО на снимке и в шапке бланка);
//   aiConsent    — согласие на обработку внешней моделью.
// Это разные вопросы и разные ответственности, поэтому и флага два. Проверка
// живёт здесь, а не в контроллере: маршрут можно добавить новый и забыть
// проверку, сервис — единственная дверь.
//
// Выполнение асинхронное «в процессе»: задание создаётся сразу (queued), врач
// получает ответ и опрашивает состояние. Инференс занимает минуты — держать
// HTTP-запрос всё это время нельзя. Вынести в BullMQ-воркер можно позже, не
// меняя контракта: runJob уже отделён от постановки.

import crypto from "node:crypto";

import DiagnosticCase from "../models/diagnosticCase.model.js";
import DiagnosticArtifact from "../models/diagnosticArtifact.model.js";
import DiagnosticJob from "../models/diagnosticJob.model.js";
import DiagnosticFinding from "../models/diagnosticFinding.model.js";
import { getModality, listModalities, supportsImages } from "./registry.js";
import { normalizeLang } from "../../ai/language.js";
import { getAnalyzer } from "../../ai/analyzers.js";
import { MAX_ARTIFACTS_PER_JOB } from "../../constants.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../../common/utils/errors.js";
import logger from "../../../../common/logger.js";

/**
 * Отпечаток входа: по нему видно, что два задания разбирали одно и то же.
 * Хеш, а не сами данные — PHI не должно появляться ещё в одном месте.
 */
export function inputHashOf({ caseDoc, artifacts }) {
  const material = [
    caseDoc.question ?? "",
    caseDoc.clinicalContext ?? "",
    ...artifacts.map((a) => `${a.kind}:${a.text ?? ""}:${JSON.stringify(a.structured ?? null)}`),
  ].join("|");
  return crypto.createHash("sha256").update(material).digest("hex").slice(0, 32);
}

/** Проверка гейтов. Возвращает список причин, по которым запускать нельзя. */
export function collectAnalysisBlockers(caseDoc, artifacts) {
  const blockers = [];
  if (!caseDoc.deidentified) {
    blockers.push("подтвердите, что материалы обезличены (нет ФИО и других данных пациента)");
  }
  if (!caseDoc.aiConsent?.confirmed) {
    blockers.push("подтвердите согласие на обработку материалов внешней моделью");
  }
  if (!artifacts.length && !caseDoc.clinicalContext) {
    blockers.push("добавьте материалы или клинический контекст");
  }

  // Файл, из которого не извлёкся текст, в разборе НЕ УЧАСТВУЕТ: модель читает
  // текст протокола и заключения, а не пиксели снимка. Раньше такой файл всё
  // равно считался материалом — проверка выше пропускала дело, разбор шёл по
  // тексту, уже лежавшему в деле, и врач получал «Разбор готов» по совершенно
  // другому материалу, чем тот, что он приложил.
  //
  // Это худший вид ошибки: не отказ, а уверенный ответ не на тот вопрос.
  // Реальный случай — приложен КТ околоносовых пазух, текст не извлёкся, а
  // разбор пришёл про внутричерепное образование из старого контекста дела.
  //
  // Структурированные данные (панель показателей) текстом не являются, но
  // разбираются, поэтому считаются полноценным материалом.
  // Изображение, которое модальность умеет читать, материалом СЧИТАЕТСЯ, даже
  // если текста в нём нет: его описание попадает в дело при загрузке
  // (imageStudyReader). Без этой оговорки включённое чтение снимков блокировал
  // бы гейт, написанный тогда, когда снимки не читались вовсе.
  const unusable = artifacts.filter(
    (a) =>
      !String(a.text ?? "").trim() &&
      !a.structured &&
      !(a.kind === "image" && a.modality && supportsImages(a.modality)),
  );
  if (unusable.length) {
    blockers.push(
      unusable.length === artifacts.length
        ? "из приложенных файлов не извлёкся текст — разбирать нечего. " +
          "Впишите текст протокола или заключения вручную либо уберите файл"
        : `из ${unusable.length} прил. файлов не извлёкся текст — в разбор они не войдут. ` +
          "Впишите их содержание вручную или уберите их, чтобы разбор не выглядел полным",
    );
  }
  if (caseDoc.status === "closed") {
    blockers.push("дело закрыто — переоткройте его, чтобы запустить разбор");
  }
  return blockers;
}

/**
 * Какие модальности разбирать. Если врач не указал — берём те, для которых
 * в деле есть материалы, плюс клинический разбор (он работает по контексту
 * дела даже без файлов).
 */
export function planModalities({ artifacts, requested }) {
  if (requested?.length) {
    return [...new Set(requested)].filter((key) => getModality(key));
  }
  const fromArtifacts = new Set(
    artifacts.map((a) => a.modality).filter((m) => m && getModality(m)),
  );
  fromArtifacts.add("clinical");
  return listModalities()
    .map((m) => m.key)
    .filter((key) => fromArtifacts.has(key));
}

/** Артефакты, которые эта модальность принимает. */
function artifactsFor(modality, artifacts) {
  return artifacts
    .filter((a) => {
      if (a.modality && a.modality !== modality.key) {
        // Клинический разбор видит всё: он про случай целиком.
        return modality.key === "clinical";
      }
      return modality.accepts.includes(a.kind);
    })
    .slice(0, MAX_ARTIFACTS_PER_JOB);
}

/**
 * Поставить задания. Ничего не выполняет — только создаёт записи и переводит
 * дело в статус «анализируется».
 */
export async function queueAnalysis({ caseId, userId, modalities: requested = [], lang = "ru" }) {
  const caseDoc = await DiagnosticCase.findOne({ _id: caseId, ownerId: userId });
  if (!caseDoc) throw new NotFoundError("Дело не найдено", { i18n: "app.case.notFound" });

  const artifacts = await DiagnosticArtifact.find({ caseId }).sort({ createdAt: 1 });

  const blockers = collectAnalysisBlockers(caseDoc, artifacts);
  if (blockers.length) {
    throw new ValidationError(`Разбор не запущен: ${blockers.join("; ")}`, { blockers });
  }

  const keys = planModalities({ artifacts, requested });
  if (!keys.length) {
    throw new ValidationError("Не выбрано ни одной модальности для разбора", { i18n: "app.diagnostics.noModalitySelected" });
  }

  const jobs = [];
  for (const key of keys) {
    const modality = getModality(key);
    const own = artifactsFor(modality, artifacts);
    jobs.push(
      await DiagnosticJob.create({
        caseId,
        ownerId: userId,
        modality: key,
        analyzer: modality.analyzer,
        artifactIds: own.map((a) => a._id),
        status: "queued",
        // Язык фиксируется в момент постановки задания, а не читается при
        // исполнении: разбор идёт в фоновом воркере, где запроса врача и его
        // языка уже нет.
        lang: normalizeLang(lang),
      }),
    );
  }

  caseDoc.status = "analyzing";
  await caseDoc.save();

  return jobs.map((j) => j.toObject());
}

/**
 * Через сколько задание считается брошенным.
 *
 * Разбор идёт В ТОМ ЖЕ ПРОЦЕССЕ, что и API (runPendingJobs вызывается из
 * контроллера без await). Значит, перезапуск процесса — деплой, падение,
 * pm2 restart — обрывает выполнение на середине, и задание навсегда остаётся в
 * статусе «выполняется»: воскрешать его некому.
 *
 * Дело при этом навсегда остаётся «Идёт разбор», хотя выводы уже получены.
 * Врач видит вечный индикатор и не понимает, ждать ему или нет; на списке дел
 * это выглядит как зависшая система.
 *
 * 15 минут — с запасом: самый долгий разбор укладывается в несколько минут.
 */
export const STALE_JOB_MS = 15 * 60 * 1000;

const ABANDONED_MESSAGE =
  "Разбор прервался (перезапуск сервера или обрыв связи). Нажмите «Попробовать ещё раз».";

/**
 * Пометить брошенные задания и пересчитать состояние их дел.
 *
 * Вызывается при ЧТЕНИИ дела и списка дел, а не по расписанию: так состояние
 * чинится ровно тогда, когда на него смотрят, и не нужен ни отдельный
 * планировщик, ни хук на старте процесса. Стоит это одного индексированного
 * запроса на открытие страницы.
 */
export async function reapStaleJobs({ caseId = null, ownerId = null, now = Date.now() } = {}) {
  const query = {
    status: { $in: ["queued", "running"] },
    createdAt: { $lt: new Date(now - STALE_JOB_MS) },
  };
  if (caseId) query.caseId = caseId;
  if (ownerId) query.ownerId = ownerId;

  const stale = await DiagnosticJob.find(query).select("_id caseId").lean();
  if (!stale.length) return 0;

  await DiagnosticJob.updateMany(
    { _id: { $in: stale.map((j) => j._id) } },
    { $set: { status: "failed", message: ABANDONED_MESSAGE, "provenance.finishedAt": new Date(now) } },
  );

  // Дело могло остаться «analyzing» только из-за этих заданий — пересчитываем.
  for (const id of [...new Set(stale.map((j) => String(j.caseId)))]) {
    await refreshCaseState(id);
  }

  logger?.warn?.({ count: stale.length }, "diagnostics: брошенные задания помечены сбойными");
  return stale.length;
}

/**
 * Выполнить одно задание. Отдельная функция — её вызывают и фоновый прогон, и
 * тесты, и (в будущем) воркер BullMQ.
 */
export async function runJob(jobId, { lang = null } = {}) {
  const job = await DiagnosticJob.findById(jobId);
  if (!job) throw new NotFoundError("Задание не найдено", { i18n: "app.diagnostics.jobNotFound" });

  // Смена языка при перезапуске. Это единственный способ получить уже
  // разобранное дело на другом языке: выводы лежат в базе готовым текстом.
  // Поэтому же перезапуск на новом языке не считается «уже выполнено» —
  // иначе кнопка молча возвращала бы старый русский результат.
  const wantLang = lang ? normalizeLang(lang) : null;
  const relang = Boolean(wantLang && wantLang !== job.lang);
  if (relang) job.lang = wantLang;

  if (job.status === "done" && !relang) return job.toObject();
  if (job.status === "running") {
    // Брошенное задание перезапускать МОЖНО — иначе «Попробовать ещё раз»
    // упирается в «уже выполняется» и дело не расклинить вообще ничем.
    const startedAt = job.provenance?.startedAt?.getTime?.() ?? 0;
    if (Date.now() - startedAt < STALE_JOB_MS) {
      throw new ConflictError("Задание уже выполняется", { i18n: "app.diagnostics.jobAlreadyRunning" });
    }
  }

  const caseDoc = await DiagnosticCase.findById(job.caseId);
  if (!caseDoc) throw new NotFoundError("Дело не найдено", { i18n: "app.case.notFound" });

  const modality = getModality(job.modality);
  const analyzer = getAnalyzer(job.analyzer);
  if (!modality || !analyzer) {
    job.status = "failed";
    job.message = "Нет обработчика для этой модальности";
    await job.save();
    return job.toObject();
  }

  const artifacts = job.artifactIds.length
    ? await DiagnosticArtifact.find({ _id: { $in: job.artifactIds } })
    : [];

  job.status = "running";
  job.provenance.startedAt = new Date();
  job.provenance.inputHash = inputHashOf({ caseDoc, artifacts });
  await job.save();

  try {
    const result = await analyzer.run({ caseDoc, artifacts, modality, lang: job.lang });

    if (result?.skipped) {
      // Пропуск — нормальный исход, а не ошибка: врачу пишем причину.
      job.status = "skipped";
      job.message = result.reason ?? "нечего разбирать";
      job.provenance.finishedAt = new Date();
      job.provenance.durationMs =
        job.provenance.finishedAt - job.provenance.startedAt;
      await job.save();
      await refreshCaseState(job.caseId);
      return job.toObject();
    }

    // Выводы ПРЕДЫДУЩИХ разборов той же модальности убираем — но только
    // сейчас, когда новые уже получены и вот-вот лягут в базу.
    //
    // Иначе «Разобрать заново» дописывал новый набор поверх старого: врач
    // видел 8 выводов, потом 17, потом 26, причём попарно почти одинаковых —
    // «лимфаденопатия, критично, уверенность средняя» рядом с
    // «лимфаденопатия, важно, уверенность низкая». Понять, какой из двух
    // актуален, по экрану было нельзя.
    //
    // Чистим здесь, а не при постановке задания: если разбор упадёт или
    // модель откажет, у врача останется прежний результат, а не пустой
    // экран. Вердикты («согласен» / «не согласен») уходят вместе со своими
    // выводами — они относились к прежней формулировке, и переносить их на
    // новую нельзя: это была бы подпись врача под текстом, которого он не
    // читал.
    // Чистим ВСЕ выводы по этой модальности, включая свои прежние. Раньше
    // здесь стояло `jobId: { $ne: job._id }`, и повторный прогон ОДНОГО И ТОГО
    // ЖЕ задания — перезапуск зависшего или смена языка — оставлял его старые
    // выводы рядом с новыми. В обычном ходе это не проявлялось: свежие выводы
    // вставляются ниже, после удаления, так что исключать их было не от чего.
    await DiagnosticFinding.deleteMany({
      caseId: job.caseId,
      modality: job.modality,
    });

    const findings = await DiagnosticFinding.insertMany(
      (result.findings ?? []).map((f) => ({
        caseId: job.caseId,
        jobId: job._id,
        ownerId: job.ownerId,
        modality: job.modality,
        title: f.title,
        detail: f.detail,
        severity: f.severity,
        confidence: f.confidence,
        checklistItem: f.checklistItem,
        recommendations: f.recommendations,
        citations: f.citations,
      })),
    );

    job.status = "done";
    job.findingsCount = findings.length;
    // «Чего не хватает» — тоже результат, и он должен доехать до врача.
    // Списком, а не склеенной строкой: на экране это отдельный блок, и
    // разбирать её обратно по «; » было бы возвратом к тексту вместо данных.
    job.dataGaps = result.dataGaps ?? [];
    job.message = result.summary ?? "";
    job.provenance.model = result.model ?? "";
    job.provenance.promptVersion = result.promptVersion ?? "";
    job.provenance.inputTokens = result.usage?.inputTokens ?? 0;
    job.provenance.outputTokens = result.usage?.outputTokens ?? 0;
    job.provenance.finishedAt = new Date();
    job.provenance.durationMs = job.provenance.finishedAt - job.provenance.startedAt;
    await job.save();
  } catch (err) {
    // Сбой одного задания не должен ронять остальные: дело живёт дальше.
    job.status = "failed";
    job.message = err?.message ?? "Ошибка разбора";
    job.provenance.finishedAt = new Date();
    job.provenance.durationMs = job.provenance.finishedAt - job.provenance.startedAt;
    await job.save();
    logger?.warn?.({ jobId: String(job._id), err }, "diagnostics job failed");
  }

  await refreshCaseState(job.caseId);
  return job.toObject();
}

/** Пересчитать счётчики дела и статус, когда все задания закончились. */
export async function refreshCaseState(caseId) {
  const [artifacts, findings, critical, pending] = await Promise.all([
    DiagnosticArtifact.countDocuments({ caseId }),
    DiagnosticFinding.countDocuments({ caseId }),
    DiagnosticFinding.countDocuments({ caseId, severity: "critical" }),
    DiagnosticJob.countDocuments({ caseId, status: { $in: ["queued", "running"] } }),
  ]);

  const caseDoc = await DiagnosticCase.findById(caseId);
  if (!caseDoc) return null;

  caseDoc.counts = { artifacts, findings, critical };
  if (caseDoc.status !== "closed") {
    // Раньше в последней ветке стояло caseDoc.status — то есть «оставить как
    // есть». Из-за этого дело, у которого разбор завершился БЕЗ выводов (все
    // задания пропущены или сбойны), навсегда оставалось «analyzing»: заданий
    // нет, выводов нет, а индикатор крутится. Врач при этом ждёт результата,
    // которого уже не будет.
    //
    // Правильное состояние здесь — «черновик»: разбора нет, дело можно
    // дополнить и запустить заново.
    if (pending > 0) caseDoc.status = "analyzing";
    else if (findings > 0) caseDoc.status = "ready";
    else caseDoc.status = "draft";
  }
  await caseDoc.save();
  return caseDoc.counts;
}

/**
 * Прогнать все ожидающие задания дела. Вызывается «в фоне» из контроллера
 * (без await) и напрямую в тестах.
 */
export async function runPendingJobs(caseId) {
  const jobs = await DiagnosticJob.find({ caseId, status: "queued" }).select("_id").lean();
  const results = [];
  for (const j of jobs) {
    // Последовательно, а не параллельно: у внешнего API есть лимиты, а
    // параллельный запуск десяти модальностей — верный способ получить 429.
    results.push(await runJob(j._id));
  }
  return results;
}
