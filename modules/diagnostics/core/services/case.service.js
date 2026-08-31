// server/modules/diagnostics/core/services/case.service.js
//
// Жизненный цикл дела и материалов.
//
// Про чтение: почти везде используется .lean() ради скорости, а с ним НЕ
// работают геттеры mongoose — то есть наружу уйдёт шифртекст. Поэтому в модуле
// есть ровно одна дверь наружу — present*(), и она расшифровывает явно.
// Правило простое: контроллер отдаёт только то, что прошло через present*.

import DiagnosticCase from "../models/diagnosticCase.model.js";
import DiagnosticArtifact from "../models/diagnosticArtifact.model.js";
import DiagnosticJob from "../models/diagnosticJob.model.js";
import DiagnosticFinding from "../models/diagnosticFinding.model.js";
import { decryptPHI } from "../../../../common/utils/phiCrypto.js";
import { paginate } from "../../../../common/utils/pagination.js";
import { ADVISORY_NOTICE } from "../../constants.js";
import { getModality } from "./registry.js";
import {
  collectAnalysisBlockers,
  refreshCaseState,
  reapStaleJobs,
} from "./analysis.service.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../../../common/utils/errors.js";

/* ─── Представление наружу (расшифровка) ──────────────────────────────── */

export function presentCase(doc) {
  if (!doc) return null;
  return {
    ...doc,
    title: decryptPHI(doc.title),
    question: decryptPHI(doc.question),
    clinicalContext: decryptPHI(doc.clinicalContext),
    doctorSummary: decryptPHI(doc.doctorSummary),
    patient: {
      ...doc.patient,
      label: decryptPHI(doc.patient?.label),
    },
  };
}

export function presentArtifact(doc) {
  if (!doc) return null;
  return {
    ...doc,
    fileName: decryptPHI(doc.fileName),
    text: decryptPHI(doc.text),
    note: decryptPHI(doc.note),
  };
}

export function presentFinding(doc) {
  if (!doc) return null;
  return {
    ...doc,
    title: decryptPHI(doc.title),
    detail: decryptPHI(doc.detail),
    correction: decryptPHI(doc.correction),
    recommendations: (doc.recommendations ?? []).map(decryptPHI),
    // Оговорка едет вместе с данными, а не только в интерфейсе: её увидит и
    // тот, кто заберёт вывод через API или в выгрузке.
    advisory: true,
    advisoryNotice: ADVISORY_NOTICE,
  };
}

/* ─── Дела ────────────────────────────────────────────────────────────── */

export async function createCase(input, { userId, clinicId = null }) {
  const doc = await DiagnosticCase.create({
    ownerId: userId,
    clinicId,
    title: input.title ?? "",
    question: input.question ?? "",
    clinicalContext: input.clinicalContext ?? "",
    patient: {
      kind: input.patient?.kind ?? "anonymous",
      patientId: input.patient?.patientId ?? null,
      label: input.patient?.label ?? "",
      ageYears: input.patient?.ageYears ?? null,
      sex: input.patient?.sex ?? "unknown",
    },
    status: "draft",
  });
  return presentCase(doc.toObject());
}

/**
 * Дела врача — страницей и с общим числом.
 *
 * Раньше отдавались «первые 50» без признака усечения: на 200+ делах врач
 * переставал видеть часть своих и не узнавал об этом. Тот же дефект уже
 * находился в каталоге тренажёра — механика теперь общая
 * (common/utils/pagination.js), чтобы не расходилась третий раз.
 *
 * Поиск по названию идёт по ЗАШИФРОВАННОМУ полю, поэтому невозможен: заголовок
 * лежит в базе шифртекстом. Отсюда фильтр только по статусу — искать по тексту
 * можно будет, когда для заголовка появится слепой индекс, как у телефона и
 * почты. Молчать об этом нельзя: отсутствующий поиск лучше поиска, который
 * ничего не находит по непонятной причине.
 */
export async function listCases({ userId, status, skip = 0, limit } = {}) {
  // Брошенные задания (обрыв процесса на середине разбора) оставляют дело
  // навсегда в статусе «Идёт разбор». Чиним при чтении списка — там, где врач
  // на это и смотрит.
  await reapStaleJobs({ ownerId: userId });

  const query = { ownerId: userId };
  if (status) query.status = status;

  const page = await paginate(DiagnosticCase, {
    query,
    sort: { updatedAt: -1 },
    skip,
    limit,
  });
  return { ...page, items: page.items.map(presentCase) };
}

/**
 * Последнее успешное задание КАЖДОЙ модальности.
 *
 * Задания копятся: каждое «Разобрать заново» добавляет новое, прежние
 * остаются в истории. Их выводы при этом удаляются (см. runJob), поэтому
 * брать summary и dataGaps со всех подряд нельзя — врач увидел бы четыре
 * ответа подряд, из них три от разборов, которых на экране уже нет.
 *
 * Ровно та же ошибка, что была с выводами, только в другом месте: история
 * нужна для происхождения, показывать надо актуальное.
 */
function latestDoneJobs(jobs) {
  const byModality = new Map();
  for (const j of jobs) {
    if (j.status !== "done") continue;
    const prev = byModality.get(j.modality);
    if (!prev || new Date(j.createdAt) >= new Date(prev.createdAt)) {
      byModality.set(j.modality, j);
    }
  }
  return [...byModality.values()];
}

/** Дело целиком: материалы, задания, выводы. Только владельцу. */
export async function getCaseFull(caseId, userId) {
  await reapStaleJobs({ caseId });

  const doc = await DiagnosticCase.findById(caseId).lean();
  if (!doc) throw new NotFoundError("Дело не найдено", { i18n: "app.case.notFound" });
  if (String(doc.ownerId) !== String(userId)) {
    throw new ForbiddenError("Это чужое дело", { i18n: "app.diagnostics.foreignCase" });
  }

  const [artifacts, jobs, findings] = await Promise.all([
    DiagnosticArtifact.find({ caseId }).sort({ createdAt: 1 }).lean(),
    DiagnosticJob.find({ caseId }).sort({ createdAt: 1 }).lean(),
    // Порядок задаёт модель (правила 8 и 11), а createdAt его сохраняет:
    // выводы вставляются одним insertMany подряд. Пересортировки по важности
    // здесь больше нет — см. findings.schema.js.
    DiagnosticFinding.find({ caseId }).sort({ createdAt: 1 }).lean(),
  ]);

  // Причины, по которым разбор сейчас не запустится, считает СЕРВЕР и отдаёт
  // готовым списком. Интерфейс их только показывает.
  //
  // Иначе клиенту пришлось бы повторять условия гейтов у себя, а две копии
  // одного правила расходятся всегда — и расходятся молча. Цена расхождения
  // здесь высокая: кнопка «Разобрать» выглядела бы активной, врач нажимал бы
  // её и получал отказ без объяснения, или, что хуже, интерфейс обещал бы
  // проверку обезличивания, которой на сервере уже нет.
  const blockers = collectAnalysisBlockers(doc, artifacts);

  return {
    case: presentCase(doc),
    artifacts: artifacts.map(presentArtifact),
    jobs: jobs.map((j) => ({
      ...j,
      modalityTitle: getModality(j.modality)?.title ?? j.modality,
    })),
    findings: findings.map(presentFinding),
    // Ответ на вопрос врача — словами, перед списком. Раньше summary уходил в
    // служебное сообщение задания и на экран не попадал вовсе: врач спрашивал
    // «какой диагноз», а получал дифференциальный ряд, из которого ведущую
    // версию надо было вычислять по порядку пунктов.
    summaries: latestDoneJobs(jobs)
      .filter((j) => String(j.message ?? "").trim())
      .map((j) => ({
        modality: j.modality,
        modalityTitle: getModality(j.modality)?.title ?? j.modality,
        text: j.message.trim(),
      })),
    // Пробелы актуальных заданий, без повторов: разные модальности часто
    // просят одно и то же (витальные показатели, лекарства), и врачу незачем
    // читать это трижды.
    dataGaps: [
      ...new Set(
        latestDoneJobs(jobs)
          .flatMap((j) => j.dataGaps ?? [])
          .map((g) => String(g).trim())
          .filter(Boolean),
      ),
    ],
    blockers,
    canAnalyze: blockers.length === 0,
    advisoryNotice: ADVISORY_NOTICE,
  };
}

export async function updateCase(caseId, patch, userId) {
  const doc = await DiagnosticCase.findOne({ _id: caseId, ownerId: userId });
  if (!doc) throw new NotFoundError("Дело не найдено", { i18n: "app.case.notFound" });
  if (doc.status === "closed") throw new ValidationError("Дело закрыто", { i18n: "app.diagnostics.caseClosed" });

  const FIELDS = ["title", "question", "clinicalContext", "deidentified", "doctorSummary"];
  for (const f of FIELDS) if (patch[f] !== undefined) doc[f] = patch[f];
  if (patch.patient) {
    doc.patient = { ...doc.patient.toObject?.() ?? doc.patient, ...patch.patient };
  }

  // Согласие фиксируем с меткой времени: «когда подтвердили» — часть ответа на
  // вопрос «на каком основании данные ушли наружу».
  if (patch.aiConsent === true) {
    doc.aiConsent = { confirmed: true, at: new Date() };
  } else if (patch.aiConsent === false) {
    doc.aiConsent = { confirmed: false, at: null };
  }

  await doc.save();
  return presentCase(doc.toObject());
}

/** Закрыть дело выводом врача. Именно врач — автор итога, не модель. */
export async function closeCase(caseId, { summary }, userId) {
  const doc = await DiagnosticCase.findOne({ _id: caseId, ownerId: userId });
  if (!doc) throw new NotFoundError("Дело не найдено", { i18n: "app.case.notFound" });
  if (!String(summary ?? "").trim()) {
    throw new ValidationError("Напишите вывод врача — дело закрывается им, а не разбором ИИ", { i18n: "app.diagnostics.doctorConclusionRequired" });
  }
  doc.doctorSummary = summary;
  doc.status = "closed";
  doc.closedAt = new Date();
  await doc.save();
  return presentCase(doc.toObject());
}

export async function reopenCase(caseId, userId) {
  const doc = await DiagnosticCase.findOne({ _id: caseId, ownerId: userId });
  if (!doc) throw new NotFoundError("Дело не найдено", { i18n: "app.case.notFound" });
  doc.status = "ready";
  doc.closedAt = null;
  await doc.save();
  return presentCase(doc.toObject());
}

/**
 * Удалить дело со всем содержимым.
 *
 * Удаление НАСТОЯЩЕЕ, а не пометка «скрыто». Врач просит убрать дело, потому
 * что оно больше не нужно — оставлять его в базе «на всякий случай» значит
 * копить данные пациентов без основания, а это ровно то, чего в модуле
 * стараются не делать.
 *
 * След при этом не исчезает: запись о самом удалении уходит в HIPAA-журнал
 * (он на добавление и живёт семь лет). То есть «что было» из базы уходит, а
 * «кто и когда это убрал» остаётся — так и должно быть.
 *
 * Порядок важен: сначала дочерние записи, потом дело. Если удаление
 * прервётся посередине, останется дело без части материалов — состояние
 * некрасивое, но безопасное. Обратный порядок оставил бы выводы и материалы
 * без дела: их никто уже не найдёт и не удалит.
 */
export async function deleteCase(caseId, userId) {
  const doc = await DiagnosticCase.findOne({ _id: caseId, ownerId: userId });
  if (!doc) throw new NotFoundError("Дело не найдено", { i18n: "app.case.notFound" });

  const [findings, jobs, artifacts] = await Promise.all([
    DiagnosticFinding.deleteMany({ caseId }),
    DiagnosticJob.deleteMany({ caseId }),
    DiagnosticArtifact.deleteMany({ caseId }),
  ]);
  await doc.deleteOne();

  return {
    deleted: true,
    counts: {
      findings: findings.deletedCount ?? 0,
      jobs: jobs.deletedCount ?? 0,
      artifacts: artifacts.deletedCount ?? 0,
    },
  };
}

/* ─── Материалы ───────────────────────────────────────────────────────── */

export async function addArtifact(caseId, input, userId) {
  const caseDoc = await DiagnosticCase.findOne({ _id: caseId, ownerId: userId });
  if (!caseDoc) throw new NotFoundError("Дело не найдено", { i18n: "app.case.notFound" });
  if (caseDoc.status === "closed") throw new ValidationError("Дело закрыто", { i18n: "app.diagnostics.caseClosed" });

  if (input.modality && !getModality(input.modality)) {
    throw new ValidationError(`Неизвестная модальность: ${input.modality}`);
  }

  const doc = await DiagnosticArtifact.create({
    caseId,
    ownerId: userId,
    kind: input.kind,
    modality: input.modality ?? "",
    url: input.url ?? "",
    mime: input.mime ?? "",
    sizeBytes: input.sizeBytes ?? null,
    fileName: input.fileName ?? "",
    text: input.text ?? "",
    structured: input.structured ?? null,
    deidentified: Boolean(input.deidentified),
    note: input.note ?? "",
  });

  await refreshCaseState(caseId);
  return presentArtifact(doc.toObject());
}

export async function removeArtifact(artifactId, userId) {
  const doc = await DiagnosticArtifact.findOne({ _id: artifactId, ownerId: userId });
  if (!doc) throw new NotFoundError("Материал не найден", { i18n: "app.diagnostics.materialNotFound" });
  const { caseId } = doc;
  await doc.deleteOne();
  await refreshCaseState(caseId);
  return { removed: true };
}

/* ─── Обратная связь врача ────────────────────────────────────────────── */

/**
 * Вердикт врача по выводу. Это и есть будущий датасет: «согласен / частично /
 * не согласен» плюс поправка. Ради этого поля модуль стоит строить рано —
 * данные копятся с первого дня работы, а не с момента, когда о них подумают.
 */
export async function setFindingVerdict(findingId, { verdict, correction }, userId) {
  const doc = await DiagnosticFinding.findOne({ _id: findingId, ownerId: userId });
  if (!doc) throw new NotFoundError("Вывод не найден", { i18n: "app.diagnostics.conclusionNotFound" });

  doc.verdict = verdict;
  doc.verdictAt = new Date();
  if (correction !== undefined) doc.correction = correction;
  await doc.save();
  return presentFinding(doc.toObject());
}

/**
 * Сводка обратной связи — метрика полезности модуля. Показывает, насколько
 * врачи соглашаются с разбором, в разрезе модальностей.
 */
export async function feedbackStats(userId) {
  const rows = await DiagnosticFinding.aggregate([
    { $match: { ownerId: userId } },
    {
      $group: {
        _id: { modality: "$modality", verdict: "$verdict" },
        count: { $sum: 1 },
      },
    },
  ]);

  const byModality = {};
  for (const r of rows) {
    const m = r._id.modality;
    byModality[m] = byModality[m] ?? { total: 0, agree: 0, partly: 0, disagree: 0, pending: 0 };
    byModality[m][r._id.verdict] = r.count;
    byModality[m].total += r.count;
  }
  return byModality;
}
