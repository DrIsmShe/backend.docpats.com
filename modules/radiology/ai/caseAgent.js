// server/modules/radiology/ai/caseAgent.js
//
// АГЕНТ-ДОВОДЧИК ЛУЧЕВОГО КЕЙСА: «снимок загружен — доведи до публикации».
//
// Разделение труда со станциями «Анализы» и «Виртуальный пациент» здесь не
// прихоть, а следствие того, что у лучевого кейса есть часть, которой машина
// не владеет. Там ночной прогон публикует сам: весь кейс — текст, и чистой
// рецензии достаточно. Здесь кейс без настоящего кадра не существует, кадр
// приносит человек, и до его прихода публиковать нечего.
//
// Отсюда форма: не «ещё один автопубликатор», а кнопка, которую админ жмёт
// ПОСЛЕ загрузки снимка. Агент делает ровно то, что машине можно:
//
//   1. проверяет предусловия, ничего не тратя на модель, если работать рано;
//   2. гоняет цикл «правка → перепроверка» (ai/autoFix.js) по ТЕКСТУ кейса,
//      причём перепроверка идёт СО СНИМКОМ — именно ради этого агент и
//      запускается после загрузки: до неё рецензент проверял текст вслепую;
//   3. публикует — но только через тот же гейт, что и человек.
//
// ЧЕГО АГЕНТ НЕ ДЕЛАЕТ И НЕ БУДЕТ ДЕЛАТЬ:
//
//   — не ставит галочку «снимок деидентифицирован». Это утверждение о
//     реальном изображении, и подписывает его тот, кто на изображение
//     смотрел. Машина, поставившая её за человека, превращает гейт
//     приватности в декорацию;
//   — не двигает и не создаёт точки находок на кадре. Координаты — это
//     эталон, по которому потом оценивают врачей;
//   — не отмечает замечания рецензента «разобранными». Гейт считает именно
//     неразобранные; проставить их машиной значило бы соврать гейту вместо
//     того, чтобы починить кейс. Поэтому агент публикует только тогда, когда
//     замечаний НЕ ОСТАЛОСЬ по существу.
//
// Все остановки агент возвращает списком blockers — тем же, что показывает
// гейт публикации. Врач видит не «не получилось», а что именно доделать.

import RadiologyCase from "../radiology-cases/models/radiologyCase.model.js";
import {
  collectPublishBlockers,
  submitForReview,
  reviewCase,
  applyRadiologyAiRevision,
} from "../radiology-cases/services/case.service.js";
import { verifyRadiologyCase } from "./caseVerifier.js";
import { reviseRadiologyCase } from "./caseReviser.js";
import { runAutoFix } from "./autoFix.js";
import { saveAiReview } from "./aiReviewStore.js";
import { MODEL } from "./aiRunner.js";
import { recordRadiologyEvent } from "../audit/audit.service.js";
import { NotFoundError } from "../../../common/utils/errors.js";

// Статусы, из которых агенту есть что делать. Опубликованный кейс правится
// только через снятие с публикации — молча мутировать живой контент нельзя:
// это рассинхронизирует попытки, переводы и статистику.
const AGENT_STATUSES = ["draft", "rejected", "in_review"];

/**
 * Кадр для перепроверки. Берём первый по порядку — тот же, который автор
 * видит открытым в редакторе; при нескольких проекциях рецензенту важнее
 * получить хоть один настоящий снимок, чем ни одного.
 */
function primaryImageUrl(doc) {
  const images = [...(doc.images ?? [])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  return images[0]?.url?.trim() || undefined;
}

/**
 * Черновик для рецензента и редактора — ровно в той форме, в какой его
 * отправляет админка: план находок и уже размеченные идут ОДНИМ списком.
 * Рецензенту важна медицинская суть, а не то, на каком поле находка лежит;
 * обратно по двум полям их разводит applyRadiologyAiRevision.
 */
function buildDraft(doc) {
  const plannedFindings = [
    ...(doc.plannedFindings ?? []).map((p) => ({
      label: p.label,
      significance: p.significance ?? "major",
      location: p.location || undefined,
      explanation: p.explanation || undefined,
    })),
    ...(doc.findings ?? []).map((f) => ({
      label: f.label,
      significance: f.significance ?? "major",
      explanation: f.explanation?.trim() || undefined,
    })),
  ];

  return {
    title: doc.title?.trim() || undefined,
    clinicalContext: doc.clinicalContext?.trim() || undefined,
    plannedFindings,
    impression: {
      correctText: doc.impression?.correctText?.trim() || undefined,
      diagnosisKeys: doc.impression?.diagnosisKeys ?? [],
      diagnosisSynonyms: doc.impression?.diagnosisSynonyms ?? [],
    },
  };
}

/**
 * Условие, без которого НЕЧЕГО ДЕЛАТЬ: нет кадра.
 *
 * Смысл агента в том, что рецензент смотрит на снимок; без снимка он проверял
 * бы текст вслепую — то же самое, что уже сделал ночной прогон. Плюс каждый
 * круг цикла стоит двух вызовов Opus с рассуждением, и тратить их на повтор
 * ночной работы незачем.
 */
function fixPrerequisites(doc) {
  return doc.images?.length
    ? []
    : ["загрузите снимок — агент запускается после кадра"];
}

/**
 * Условие, без которого нельзя ПУБЛИКОВАТЬ, но правке оно не мешает.
 *
 * Разделение важнее, чем кажется. Первая версия агента считала неразмеченный
 * план предусловием и отказывалась работать: кейс с четырьмя находками в плане,
 * нулём точек на кадре и шестью замечаниями рецензента не получал ничего —
 * агент выходил, не вызвав модель, и человек видел «изменений нет».
 *
 * Между тем именно такому кейсу правка нужнее всего: половина замечаний
 * рецензента звучит как «этой находки на срезе не видно — уберите её из плана и
 * из заключения», и это ровно та текстовая работа, которую машине делать можно.
 * Разметка нужна для публикации, а не для того, чтобы привести текст в
 * соответствие со снимком.
 *
 * Пустой план при пустой разметке блокером НЕ считается: это кейс «норма», где
 * находок нет по замыслу автора.
 */
function markupBlockers(doc) {
  if ((doc.plannedFindings?.length ?? 0) > 0 && (doc.findings?.length ?? 0) === 0) {
    return [
      `перенесите находки из плана на снимок (${doc.plannedFindings.length}) — координаты ставит человек`,
    ];
  }
  return [];
}

/**
 * Довести лучевой кейс до публикации.
 *
 * @param {object} args
 * @param {string} args.caseId
 * @param {string} args.actorId
 * @param {string} args.actorRole
 * @param {number} [args.maxRounds]  кругов правки, по умолчанию 3
 * @param {string} [args.hint]       указание автора редактору — главнее замечаний
 * @param {boolean} [args.publish]   false — только починить, не публиковать
 * @returns {Promise<object>} отчёт о прогоне
 */
export async function runRadiologyCaseAgent({
  caseId,
  actorId,
  actorRole,
  maxRounds = 3,
  hint,
  publish = true,
}) {
  const doc = await RadiologyCase.findById(caseId);
  if (!doc) throw new NotFoundError("Radiology case");

  const base = {
    caseId: String(doc._id),
    status: doc.status,
    published: false,
    fixed: false,
    converged: false,
    rounds: [],
    changes: [],
    disputed: [],
    blockers: [],
    review: null,
    markupPresent: (doc.findings?.length ?? 0) > 0,
    usage: { inputTokens: 0, outputTokens: 0 },
  };

  if (doc.status === "published") {
    return { ...base, stoppedBy: "already_published" };
  }
  if (!AGENT_STATUSES.includes(doc.status)) {
    return {
      ...base,
      stoppedBy: "not_editable",
      blockers: [`кейс в статусе "${doc.status}" — агенту он недоступен`],
    };
  }

  const pre = fixPrerequisites(doc);
  if (pre.length) {
    return { ...base, stoppedBy: "prerequisites", blockers: pre };
  }

  // ─── Цикл правки ────────────────────────────────────────────────────────
  const modality = doc.modality;
  const imageUrl = primaryImageUrl(doc);
  const draft = buildDraft(doc);

  const revise = (current, issues) =>
    reviseRadiologyCase({ draft: current, issues, modality, hint });
  const verify = (current) =>
    verifyRadiologyCase({ draft: current, modality, imageUrl });

  const out = await runAutoFix({ draft, revise, verify, maxRounds });

  // Сначала кейс, потом рецензия: обратный порядок оставил бы чистую рецензию
  // на неисправленной версии.
  const applied = await applyRadiologyAiRevision(caseId, out.draft, {
    rounds: out.rounds.length,
    stoppedBy: out.stoppedBy,
    converged: out.converged,
    changes: out.changes,
    disputed: out.disputed,
    model: MODEL,
    actorId,
  });
  await saveAiReview({ CaseModel: RadiologyCase, caseId, review: out.review });

  const report = {
    ...base,
    fixed: true,
    converged: out.converged,
    stoppedBy: out.stoppedBy,
    rounds: out.rounds,
    changes: out.changes ?? [],
    disputed: out.disputed ?? [],
    review: out.review,
    markupPresent: applied.markupPresent,
    usage: out.usage,
  };

  recordRadiologyEvent({
    action: "case.agent.run",
    actorId,
    actorRole,
    caseId: doc._id,
    metadata: {
      rounds: out.rounds.length,
      stoppedBy: out.stoppedBy,
      issuesLeft: out.review?.issues?.length ?? 0,
      withImage: Boolean(imageUrl),
    },
  });

  // ─── Публикация ─────────────────────────────────────────────────────────
  // Перечитываем документ: applyRadiologyAiRevision его изменил, а гейт должен
  // смотреть на то, что реально лежит в базе, а не на версию до правки.
  const fresh = await RadiologyCase.findById(caseId);
  // К гейту добавляем требование разметки: сам гейт её не проверяет (кейс
  // «норма» публикуется без находок), но кейс с непереносённым планом — это
  // незаконченная работа, и публиковать его агенту нельзя.
  const blockers = [...collectPublishBlockers(fresh), ...markupBlockers(fresh)];
  report.status = fresh.status;
  report.blockers = blockers;

  if (!publish || blockers.length) return report;

  // Публикуем ТЕМ ЖЕ путём, что и человек: submit → approve. Свой короткий
  // путь означал бы вторую копию гейта, которая однажды разойдётся с первой.
  if (fresh.status === "draft" || fresh.status === "rejected") {
    await submitForReview(caseId, actorId, actorRole);
  }
  const publishedDoc = await reviewCase(
    caseId,
    { decision: "approve" },
    actorId,
    actorRole,
  );

  report.published = true;
  report.status = publishedDoc.status;
  return report;
}

export default runRadiologyCaseAgent;
