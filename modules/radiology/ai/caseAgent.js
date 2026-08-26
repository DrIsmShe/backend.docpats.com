// server/modules/radiology/ai/caseAgent.js
//
// АГЕНТ-ДОВОДЧИК КЕЙСА: «доделай и опубликуй».
//
// Одна и та же работа для трёх станций арены: взять СОХРАНЁННЫЙ кейс, довести
// его текст до чистой рецензии циклом «правка → перепроверка» (ai/autoFix.js) и
// опубликовать — через тот же гейт, которым пользуется человек.
//
// Почему станции живут в одном файле, а не тремя копиями. Отличий между ними
// ровно четыре: форма черновика, кто рецензирует, кто применяет правку и что
// именно блокирует публикацию. Всё остальное — порядок шагов, работа с гейтом,
// аудит, форма отчёта — совпадает буквально, и три копии этого кода разошлись
// бы на первой же правке. Различия вынесены в STATIONS ниже.
//
// ЧЕМ ЭТО ОТЛИЧАЕТСЯ ОТ /ai/autofix. Тот правит черновик ИЗ ФОРМЫ и возвращает
// его в форму, оставляя публикацию человеку. Агент работает с тем, что лежит в
// базе, и доводит кейс до конца. Для лучевой станции это к тому же
// единственный способ проверить текст ПО СНИМКУ: перепроверка получает кадр,
// которого в момент ночной генерации не существовало.
//
// ЧЕГО АГЕНТ НЕ ДЕЛАЕТ НИ НА ОДНОЙ СТАНЦИИ:
//
//   — не отмечает замечания рецензента «разобранными». Гейт считает именно
//     неразобранные; проставить их машиной значило бы соврать гейту вместо
//     того, чтобы починить кейс. Поэтому публикация возможна только тогда,
//     когда замечаний не осталось ПО СУЩЕСТВУ;
//   — не подтверждает деидентификацию снимка и не двигает точки находок на
//     кадре (лучевая станция). И то и другое — утверждение о реальном
//     изображении, подписывает его тот, кто изображение видел;
//   — не обходит гейт публикации. Все препятствия возвращаются списком
//     blockers — человек видит не «не получилось», а что именно доделать.

import RadiologyCase from "../radiology-cases/models/radiologyCase.model.js";
import LabCase from "../labs-station/models/labCase.model.js";
import VirtualPatientCase from "../virtual-patient/models/vpCase.model.js";

import {
  collectPublishBlockers,
  submitForReview,
  reviewCase,
  applyRadiologyAiRevision,
} from "../radiology-cases/services/case.service.js";
import {
  collectLabBlockers,
  applyLabAiRevision,
  setLabStatus,
} from "../labs-station/lab.service.js";
import {
  collectVpBlockers,
  applyVpAiRevision,
  setVpStatus,
} from "../virtual-patient/vp.service.js";

import {
  verifyRadiologyCase,
  verifyLabCase,
  verifyVpCase,
} from "./caseVerifier.js";
import {
  reviseRadiologyCase,
  reviseLabCase,
  reviseVpCase,
} from "./caseReviser.js";
import { runAutoFix } from "./autoFix.js";
import { saveAiReview } from "./aiReviewStore.js";
import { MODEL } from "./aiRunner.js";
import { recordRadiologyEvent } from "../audit/audit.service.js";
import { NotFoundError, ValidationError } from "../../../common/utils/errors.js";

// Статусы, из которых агенту есть что делать. Опубликованный кейс правится
// только через снятие с публикации — молча мутировать живой контент нельзя:
// это рассинхронизирует попытки, переводы и статистику.
const AGENT_STATUSES = ["draft", "rejected", "in_review"];

/* ══════════════════════════════════════════════════════════════════════════
   ЛУЧЕВАЯ СТАНЦИЯ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Кадр для перепроверки. Берём первый по порядку — тот же, который автор видит
 * открытым в редакторе; при нескольких проекциях рецензенту важнее получить
 * хоть один настоящий снимок, чем ни одного.
 */
function primaryImageUrl(doc) {
  const images = [...(doc.images ?? [])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  return images[0]?.url?.trim() || undefined;
}

/**
 * Черновик лучевого кейса — ровно в той форме, в какой его отправляет админка:
 * план находок и уже размеченные идут ОДНИМ списком. Рецензенту важна
 * медицинская суть, а не то, на каком поле находка лежит; обратно по двум полям
 * их разводит applyRadiologyAiRevision.
 */
function buildRadiologyDraft(doc) {
  return {
    title: doc.title?.trim() || undefined,
    clinicalContext: doc.clinicalContext?.trim() || undefined,
    plannedFindings: [
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
    ],
    impression: {
      correctText: doc.impression?.correctText?.trim() || undefined,
      diagnosisKeys: doc.impression?.diagnosisKeys ?? [],
      diagnosisSynonyms: doc.impression?.diagnosisSynonyms ?? [],
    },
  };
}

/**
 * Условие, без которого лучевому агенту НЕЧЕГО ДЕЛАТЬ: нет кадра.
 *
 * Смысл запуска в том, что рецензент смотрит на снимок; без снимка он проверял
 * бы текст вслепую — то же самое, что уже сделал ночной прогон. Плюс каждый
 * круг цикла стоит двух вызовов модели с рассуждением.
 */
function radiologyFixPrerequisites(doc) {
  return doc.images?.length
    ? []
    : ["загрузите снимок — агент запускается после кадра"];
}

/**
 * Условие, без которого нельзя ПУБЛИКОВАТЬ лучевой кейс, но правке оно не
 * мешает.
 *
 * Разделение важнее, чем кажется, и стоило разбора на проде. Первая версия
 * считала неразмеченный план предусловием и выходила, не вызвав модель: кейс с
 * четырьмя находками в плане, нулём точек на кадре и шестью замечаниями
 * рецензента не получал ничего, а человек видел «изменений нет». Между тем
 * именно такому кейсу правка нужнее всего — половина замечаний там звучит как
 * «этой находки на срезе не видно, уберите её из плана и заключения», и это
 * ровно та текстовая работа, которую машине делать можно.
 *
 * Пустой план при пустой разметке блокером НЕ считается: это кейс «норма», где
 * находок нет по замыслу автора.
 */
function radiologyMarkupBlockers(doc) {
  if ((doc.plannedFindings?.length ?? 0) > 0 && (doc.findings?.length ?? 0) === 0) {
    return [
      `перенесите находки из плана на снимок (${doc.plannedFindings.length}) — координаты ставит человек`,
    ];
  }
  return [];
}

/* ══════════════════════════════════════════════════════════════════════════
   АНАЛИЗЫ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Черновик кейса «Анализы». Панель уходит модели БЕЗ ключей — она их не видит и
 * видеть не должна: на ключ завязаны эталон, числовые варианты и разборы уже
 * сданных попыток. Обратно ключи восстанавливает applyLabAiRevision,
 * сопоставляя показатели по названию.
 *
 * Признак significant модель получает флагом на строке, а не отдельным списком
 * ключей: списка ключей ей не с чем сопоставить.
 */
function buildLabDraft(doc) {
  const significant = new Set(doc.significantAbnormal ?? []);
  return {
    title: doc.title?.trim() || undefined,
    clinicalContext: doc.clinicalContext?.trim() || undefined,
    panel: (doc.panel ?? []).map((p) => ({
      name: p.name,
      value: p.value,
      unit: p.unit || undefined,
      refRange: p.refRange || undefined,
      significant: significant.has(p.key),
    })),
    impression: {
      correctText: doc.impression?.correctText?.trim() || undefined,
      diagnosisKeys: doc.impression?.diagnosisKeys ?? [],
      diagnosisSynonyms: doc.impression?.diagnosisSynonyms ?? [],
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   ВИРТУАЛЬНЫЙ ПАЦИЕНТ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Черновик сценария. Как и у «Анализов», обследования уходят без ключей и
 * возвращаются по названию (applyVpAiRevision). imageUrl редактору не
 * показывается вовсе — он с изображениями не работает, а applyVpAiRevision
 * переносит ссылку в исправленную версию сам.
 */
function buildVpDraft(doc) {
  return {
    title: doc.title?.trim() || undefined,
    presentation: doc.presentation?.trim() || undefined,
    investigations: (doc.investigations ?? []).map((i) => ({
      name: i.name,
      category: i.category || undefined,
      resultText: i.resultText || undefined,
      necessary: Boolean(i.necessary),
    })),
    diagnosis: {
      correctText: doc.diagnosis?.correctText?.trim() || undefined,
      diagnosisKeys: doc.diagnosis?.diagnosisKeys ?? [],
      diagnosisSynonyms: doc.diagnosis?.diagnosisSynonyms ?? [],
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   РЕЕСТР СТАНЦИЙ
   ══════════════════════════════════════════════════════════════════════════ */

const STATIONS = {
  radiology: {
    label: "снимки",
    Model: RadiologyCase,
    notFound: "Radiology case",
    auditAction: "case.agent.run",
    fixPrerequisites: radiologyFixPrerequisites,
    buildDraft: buildRadiologyDraft,
    // Перепроверка идёт СО СНИМКОМ: рецензент должен смотреть на тот же кадр,
    // что и учащийся, иначе исправленный текст будет проверен слабее исходного.
    verify: (draft, doc) =>
      verifyRadiologyCase({
        draft,
        modality: doc.modality,
        imageUrl: primaryImageUrl(doc),
      }),
    revise: (draft, issues, doc, hint) =>
      reviseRadiologyCase({ draft, issues, modality: doc.modality, hint }),
    applyRevision: applyRadiologyAiRevision,
    // К гейту добавляем требование разметки: сам гейт её не проверяет (кейс
    // «норма» публикуется без находок), но кейс с непереносённым планом — это
    // незаконченная работа, и публиковать его агенту нельзя.
    publishBlockers: (doc) => [
      ...collectPublishBlockers(doc),
      ...radiologyMarkupBlockers(doc),
    ],
    // Публикуем ТЕМ ЖЕ путём, что и человек: submit → approve. Свой короткий
    // путь означал бы вторую копию гейта, которая однажды разойдётся с первой.
    async publish(caseId, doc, actorId, actorRole) {
      if (doc.status === "draft" || doc.status === "rejected") {
        await submitForReview(caseId, actorId, actorRole);
      }
      return reviewCase(caseId, { decision: "approve" }, actorId, actorRole);
    },
    // Находки уже размечены на кадре, а план правился — их могло развести в
    // стороны. Свести обратно может только человек у холста.
    reportExtras: (applied) => ({ markupPresent: applied.markupPresent }),
  },

  labs: {
    label: "анализы",
    Model: LabCase,
    notFound: "Lab case",
    auditAction: "lab.agent.run",
    // Панель — это весь кейс; рецензировать пустую бессмысленно, а гейт всё
    // равно потребует минимум два показателя.
    fixPrerequisites: (doc) =>
      (doc.panel?.length ?? 0) > 0
        ? []
        : ["добавьте показатели в панель — править нечего"],
    buildDraft: buildLabDraft,
    verify: (draft) => verifyLabCase({ draft }),
    revise: (draft, issues, doc, hint) => reviseLabCase({ draft, issues, hint }),
    applyRevision: applyLabAiRevision,
    publishBlockers: collectLabBlockers,
    // setLabStatus сам проверяет гейт и сам ставит перевод на все языки в
    // очередь — второй проверки здесь не нужно.
    publish: (caseId, doc, actorId, actorRole) =>
      setLabStatus(caseId, "published", actorId, actorRole),
    // Числовые варианты кейса привязаны к ключам панели: если редактор менял
    // значения, варианты могли устареть, и об этом должен знать человек.
    reportExtras: (applied) => ({ variantsStale: applied.variantsStale }),
  },

  vp: {
    label: "виртуальный пациент",
    Model: VirtualPatientCase,
    notFound: "VP case",
    auditAction: "vp.agent.run",
    fixPrerequisites: (doc) =>
      (doc.investigations?.length ?? 0) > 0
        ? []
        : ["добавьте обследования — править нечего"],
    buildDraft: buildVpDraft,
    verify: (draft) => verifyVpCase({ draft }),
    revise: (draft, issues, doc, hint) => reviseVpCase({ draft, issues, hint }),
    applyRevision: applyVpAiRevision,
    publishBlockers: collectVpBlockers,
    publish: (caseId, doc, actorId, actorRole) =>
      setVpStatus(caseId, "published", actorId, actorRole),
    reportExtras: (applied) => ({ variantsStale: applied.variantsStale }),
  },
};

export const AGENT_STATIONS = Object.keys(STATIONS);

/* ══════════════════════════════════════════════════════════════════════════
   ПРОГОН
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Довести кейс до публикации.
 *
 * @param {object}  args
 * @param {"radiology"|"labs"|"vp"} args.station
 * @param {string}  args.caseId
 * @param {string}  args.actorId
 * @param {string}  args.actorRole
 * @param {number}  [args.maxRounds]  кругов правки, по умолчанию 3
 * @param {string}  [args.hint]       указание автора редактору — главнее замечаний
 * @param {boolean} [args.publish]    false — только починить, не публиковать
 * @returns {Promise<object>} отчёт о прогоне
 */
export async function runCaseAgent({
  station,
  caseId,
  actorId,
  actorRole,
  maxRounds = 3,
  hint,
  publish = true,
}) {
  const cfg = STATIONS[station];
  if (!cfg) throw new ValidationError(`Неизвестная станция "${station}"`);

  const doc = await cfg.Model.findById(caseId);
  if (!doc) throw new NotFoundError(cfg.notFound);

  const base = {
    station,
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

  const pre = cfg.fixPrerequisites(doc);
  if (pre.length) {
    return { ...base, stoppedBy: "prerequisites", blockers: pre };
  }

  // ─── Цикл правки ────────────────────────────────────────────────────────
  const draft = cfg.buildDraft(doc);
  const revise = (current, issues) => cfg.revise(current, issues, doc, hint);
  const verify = (current) => cfg.verify(current, doc);

  const out = await runAutoFix({ draft, revise, verify, maxRounds });

  // Сначала кейс, потом рецензия: обратный порядок оставил бы чистую рецензию
  // на неисправленной версии, то есть открыл бы гейт тому, чего рецензент не
  // видел.
  const applied = await cfg.applyRevision(caseId, out.draft, {
    rounds: out.rounds.length,
    stoppedBy: out.stoppedBy,
    converged: out.converged,
    changes: out.changes,
    disputed: out.disputed,
    model: MODEL,
    actorId,
  });
  await saveAiReview({ CaseModel: cfg.Model, caseId, review: out.review });

  const report = {
    ...base,
    fixed: true,
    converged: out.converged,
    stoppedBy: out.stoppedBy,
    rounds: out.rounds,
    changes: out.changes ?? [],
    disputed: out.disputed ?? [],
    review: out.review,
    usage: out.usage,
    ...cfg.reportExtras(applied),
  };

  recordRadiologyEvent({
    action: cfg.auditAction,
    actorId,
    actorRole,
    caseId: doc._id,
    metadata: {
      rounds: out.rounds.length,
      stoppedBy: out.stoppedBy,
      issuesLeft: out.review?.issues?.length ?? 0,
    },
  });

  // ─── Публикация ─────────────────────────────────────────────────────────
  // Перечитываем документ: applyRevision его изменил, а гейт должен смотреть на
  // то, что реально лежит в базе, а не на версию до правки.
  const fresh = await cfg.Model.findById(caseId);
  const blockers = cfg.publishBlockers(fresh);
  report.status = fresh.status;
  report.blockers = blockers;

  if (!publish || blockers.length) return report;

  const publishedDoc = await cfg.publish(caseId, fresh, actorId, actorRole);
  report.published = true;
  report.status = publishedDoc.status;
  return report;
}

// Именованные обёртки — контроллеры станций не должны знать про строковый ключ
// реестра: опечатка в нём падала бы только в рантайме.
export const runRadiologyCaseAgent = (args) =>
  runCaseAgent({ ...args, station: "radiology" });
export const runLabCaseAgent = (args) =>
  runCaseAgent({ ...args, station: "labs" });
export const runVpCaseAgent = (args) => runCaseAgent({ ...args, station: "vp" });

export default runCaseAgent;
