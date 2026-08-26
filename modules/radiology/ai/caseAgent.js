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
// ЗАСТРЯВШИЕ ЗАМЕЧАНИЯ. Цикл правки останавливается, когда замечаний
// перестаёт становиться меньше, — дальше редактор и рецензент топчутся. Гейт
// при этом считает ЛЮБОЕ неразобранное замечание, и агент, которому раньше
// было запрещено их закрывать, не мог опубликовать ничего, где рецензент
// упёрся хоть в одну строку: почти каждый прогон заканчивался словами
// «осталось сделать вам», кейс оставался черновиком, а переводы — которые
// запускаются публикацией — не появлялись вовсе.
//
// Поэтому у агента есть последний шаг: РАЗБОР (ai/issueAdjudicator.js).
// Отдельный вызов судит каждое застрявшее замечание — верное оно или нет.
// Верные уходят на точечную правку, неверные закрываются с письменным
// обоснованием, и обоснование остаётся в кейсе (aiReview.agentResolved).
// Гейт не ослаблен: он по-прежнему требует решения по каждому замечанию —
// просто теперь машина умеет его принять и за него отчитаться. Замечания,
// которые судья счёл верными и которые не удалось исправить, остаются
// открытыми и держат публикацию, как раньше.
//
// ЧЕГО ЭТО НЕ ЧИНИТ. Судья — та же модель, что писала кейс и рецензировала
// его. Спор между её ролями она разрешает хорошо, общее для всех трёх
// заблуждение — правдоподобный неверный референс — переживает и этот шаг.
// «Агент закрыл замечания» значит «противоречий не осталось», а не «кейс
// верен», и отчёт агента говорит это прямо.
//
// ЧЕГО АГЕНТ НЕ ДЕЛАЕТ НИ НА ОДНОЙ СТАНЦИИ:
//
//   — не закрывает замечание молча. Каждое закрытое машиной замечание несёт
//     обоснование, показывается человеку отдельным списком и снимается
//     обратно одним кликом. Закрытие без обоснования отбрасывается;
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
import { runAutoFix, runTargetedFix } from "./autoFix.js";
import { saveAiReview, resolveAiIssuesByAgent } from "./aiReviewStore.js";
import { adjudicateIssues } from "./issueAdjudicator.js";
import { startCaseTranslation } from "../translation/onPublish.js";
import { MODEL } from "./aiRunner.js";
import { recordRadiologyEvent } from "../audit/audit.service.js";
import { NotFoundError, ValidationError } from "../../../common/utils/errors.js";

// Статусы, из которых агенту есть что делать. Опубликованный кейс правится
// только через снятие с публикации — молча мутировать живой контент нельзя:
// это рассинхронизирует попытки, переводы и статистику.
const AGENT_STATUSES = ["draft", "rejected", "in_review"];

// СРОК ПРОГОНА. Агент живёт внутри HTTP-запроса, а nginx перед ним рвёт
// соединение на 240 с (proxy_read_timeout). Работа при этом НЕ прекращается:
// узел досчитывает круги, публикует кейс и переводит его — просто ответа уже
// никто не ждёт. Ровно это и случилось на бою: кейс станции «Анализы» был
// опубликован и переведён на четыре языка, а врач увидел «Network Error» и
// решил, что ничего не произошло. Успешная работа под видом сбоя хуже
// честного отказа, поэтому агент обязан вернуться САМ и с запасом.
//
// Запас нужен на то, что уже нельзя прервать: начатый вызов модели. Круг —
// это два вызова Opus с рассуждением, и каждый может идти под минуту.
const DEADLINE_MS = Number(process.env.RADIOLOGY_AGENT_DEADLINE_MS ?? 180_000);

// Сколько ждать перевод, прежде чем ответить «идёт в фоне». Перевод — это
// четыре вызова модели, и держать ради них ответ смысла нет: кейс уже
// опубликован, врачи видят его на языке оригинала, а языки догоняются сами.
// Ждём лишь столько, чтобы обычный быстрый случай успел попасть в отчёт.
const TRANSLATION_WAIT_MS = Number(
  process.env.RADIOLOGY_AGENT_TRANSLATION_WAIT_MS ?? 25_000,
);

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
 * @param {boolean} [args.resolveIssues] false — не разбирать застрявшие
 *        замечания судьёй и оставить их человеку (поведение до разбора)
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
  resolveIssues = true,
}) {
  const cfg = STATIONS[station];
  if (!cfg) throw new ValidationError(`Неизвестная станция "${station}"`);

  const deadlineAt = Date.now() + DEADLINE_MS;
  const timeLeft = () => deadlineAt - Date.now();

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
    // Замечания, закрытые судьёй, и те, которые он счёл верными, но
    // исправить не вышло. Второй список — то, ради чего человека зовут.
    resolvedByAgent: [],
    unresolvedFounded: [],
    translation: null,
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

  const out = await runAutoFix({ draft, revise, verify, maxRounds, deadlineAt });

  const usage = { ...out.usage };
  const addUsage = (u) => {
    usage.inputTokens += u?.inputTokens ?? 0;
    usage.outputTokens += u?.outputTokens ?? 0;
  };

  let bestDraft = out.draft;
  let bestReview = out.review;
  let allChanges = [...(out.changes ?? [])];
  const rounds = [...out.rounds];
  let stoppedBy = out.stoppedBy;

  // ─── Разбор застрявших замечаний ────────────────────────────────────────
  // Судья высказывается по каждому оставшемуся; верные уходят на точечную
  // правку ровно по ним, и только после неё что-то закрывается. Порядок
  // именно такой: закрыть замечание, не попытавшись его исправить, значит
  // разменять качество кейса на зелёный гейт.
  let resolvedByAgent = [];
  let unresolvedFounded = [];
  let adjudicationError = null;
  // Что именно закрывать: индексы в ИТОГОВОМ списке замечаний (bestReview).
  let toClose = [];

  // Разбор — это ещё до четырёх вызовов модели. Начинаем, только если на них
  // остаётся время: оборванный снаружи разбор — это оплаченные вызовы, ответ
  // от которых никто не увидит.
  const canAdjudicate =
    resolveIssues && (bestReview?.issues?.length ?? 0) > 0 && timeLeft() > 45_000;

  if (resolveIssues && !canAdjudicate && (bestReview?.issues?.length ?? 0) > 0) {
    stoppedBy = "deadline";
  }

  if (canAdjudicate) {
    let verdicts = [];
    try {
      const judged = await adjudicateIssues({
        draft: bestDraft,
        issues: bestReview.issues,
        station: cfg.label,
      });
      addUsage(judged.usage);
      verdicts = judged.verdicts;

      const founded = verdicts
        .filter((v) => v.founded)
        .map((v) => bestReview.issues[v.index])
        .filter(Boolean);

      // На точечную правку нужен ещё круг плюс повторный разбор. Не влезаем —
      // закрываем то, что уже признано неверным, а верные честно отдаём
      // человеку: закрыть непочиненное было бы разменом качества на срок.
      if (founded.length && timeLeft() > 60_000) {
        const fix = await runTargetedFix({
          draft: bestDraft,
          issues: founded,
          revise,
          verify,
        });
        addUsage(fix.usage);
        bestDraft = fix.draft;
        bestReview = fix.review;
        allChanges = [...allChanges, ...(fix.changes ?? [])];
        rounds.push(...fix.rounds);
        stoppedBy = "adjudicated";

        // Список замечаний сменился целиком — прежние вердикты указывали на
        // другие номера. Судим заново то, что осталось после правки.
        verdicts = [];
        if ((bestReview?.issues?.length ?? 0) > 0) {
          const again = await adjudicateIssues({
            draft: bestDraft,
            issues: bestReview.issues,
            station: cfg.label,
          });
          addUsage(again.usage);
          verdicts = again.verdicts;
        }
      }
    } catch (err) {
      // Сбой судьи не отменяет уже сделанной правки: отдаём кейс как есть,
      // замечания остаются человеку. Отдельный stoppedBy, чтобы это не
      // выглядело как «модель не нашла, что чинить».
      stoppedBy = "adjudication_failed";
      verdicts = [];
      adjudicationError = err?.message ?? String(err);
    }

    toClose = verdicts
      .filter((v) => !v.founded && bestReview.issues[v.index])
      .map((v) => ({ index: v.index, why: v.why }));

    resolvedByAgent = toClose.map((v) => ({
      issue: bestReview.issues[v.index].issue,
      why: v.why,
    }));
    unresolvedFounded = verdicts
      .filter((v) => v.founded && bestReview.issues[v.index])
      .map((v) => ({ issue: bestReview.issues[v.index].issue, why: v.why }));
  }

  // Сначала кейс, потом рецензия: обратный порядок оставил бы чистую рецензию
  // на неисправленной версии, то есть открыл бы гейт тому, чего рецензент не
  // видел.
  const applied = await cfg.applyRevision(caseId, bestDraft, {
    rounds: rounds.length,
    stoppedBy,
    converged: (bestReview?.issues?.length ?? 0) === 0,
    changes: allChanges,
    disputed: out.disputed,
    model: MODEL,
    actorId,
  });
  await saveAiReview({ CaseModel: cfg.Model, caseId, review: bestReview });

  // Отметки судьи ставятся ПОСЛЕ сохранения рецензии: saveAiReview сбрасывает
  // dismissed (новая рецензия — новые номера), и обратный порядок стёр бы их.
  if (toClose.length) {
    await resolveAiIssuesByAgent({
      CaseModel: cfg.Model,
      caseId,
      resolved: toClose,
    });
  }

  const report = {
    ...base,
    fixed: true,
    converged: (bestReview?.issues?.length ?? 0) === 0,
    stoppedBy,
    rounds,
    changes: allChanges,
    disputed: out.disputed ?? [],
    review: bestReview,
    resolvedByAgent,
    unresolvedFounded,
    adjudicationError,
    usage,
    ...cfg.reportExtras(applied),
  };

  recordRadiologyEvent({
    action: cfg.auditAction,
    actorId,
    actorRole,
    caseId: doc._id,
    metadata: {
      rounds: rounds.length,
      stoppedBy,
      issuesLeft: bestReview?.issues?.length ?? 0,
      // Что именно машина закрыла своим решением — это главное, что аудит
      // обязан помнить об агенте: по нему потом отвечают на вопрос
      // «кто пропустил эту ошибку в опубликованный кейс».
      closedByAgent: resolvedByAgent.map((r) => ({ issue: r.issue, why: r.why })),
      foundedLeft: unresolvedFounded.length,
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

  // ─── Перевод ────────────────────────────────────────────────────────────
  // Публикация уже поставила перевод (scheduleCaseTranslation в сервисе
  // статуса). Агент ЖДЁТ ту же самую работу — startCaseTranslation отдаёт
  // идущее обещание, а не запускает второе, — чтобы в отчёте стояло, на
  // каких языках кейс теперь есть, а не «поставлено в очередь, проверьте
  // сами». Сбой перевода публикацию не отменяет: кейс уже виден врачам на
  // языке оригинала, а недостающие языки догоняются кнопкой «перевести
  // недостающее» и лениво при первом открытии.
  //
  // Ждём его ОГРАНИЧЕННО. Перевод — четыре вызова модели; дожидаться их всех
  // означало держать HTTP-ответ дольше, чем живёт соединение через nginx, и
  // отдавать врачу «Network Error» на кейсе, который на самом деле
  // опубликован и переведён. Не успели — отвечаем «идёт в фоне»: обещание
  // продолжает работать, повторный вход присоединится к нему, а языки в любом
  // случае догоняются лениво при первом открытии кейса врачом.
  const translating = startCaseTranslation(station, caseId, { actorId })
    .then((tr) => ({
      created: (tr?.created ?? []).map((r) => r.lang),
      updated: (tr?.updated ?? []).map((r) => r.lang),
      skipped: (tr?.skipped ?? []).map((r) => r.lang),
      failed: (tr?.failed ?? []).map((r) => r.lang),
    }))
    // Ловим здесь, а не в race: иначе проигравшая гонку ошибка всплыла бы
    // необработанным отказом уже после ответа и уронила бы процесс.
    .catch((err) => ({ error: err?.message ?? String(err) }));

  let timer;
  const waited = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ pending: true }), TRANSLATION_WAIT_MS);
  });
  report.translation = await Promise.race([translating, waited]);
  clearTimeout(timer);

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
