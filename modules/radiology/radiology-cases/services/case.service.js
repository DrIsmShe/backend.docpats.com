// server/modules/radiology/radiology-cases/services/case.service.js
//
// Жизненный цикл учебного кейса: создание/правка авторами → ревью →
// публикация. Наружу учащемуся кейс отдаётся только «санитизованным» —
// без эталона находок и заключения, иначе ответ виден до попытки.
//
// Гейт публикации (assertPublishable) разделяет корректность/права и
// приватность: без подтверждённой деидентификации снимок не публикуется —
// это HIPAA-платформа.

import RadiologyCase from "../models/radiologyCase.model.js";
import RadiologyAttempt from "../../radiology-attempts/models/radiologyAttempt.model.js";
import ArenaCaseTranslation from "../../translation/arenaCaseTranslation.model.js";
import {
  getReadingSystem,
  hasReadingSystem,
} from "../../reading-systems/index.js";
import { findingsForModality } from "../../lexicon/lexicon.js";
import { recordCaseStats } from "../../radiology-attempts/services/caseStats.service.js";
import { unresolvedAiIssues } from "../../ai/aiReviewFields.js";
import { paginate, titleFilter } from "../../catalog.js";
import { recordRadiologyEvent } from "../../audit/audit.service.js";
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from "../../../../common/utils/errors.js";

// Статусы, из которых кейс можно ОТПРАВИТЬ на ревью.
import { scheduleCaseTranslation } from "../../translation/onPublish.js";
import {
  translateCaseList,
  translatedCaseFor,
} from "../../translation/translatedCase.js";

const EDITABLE = ["draft", "rejected"];

// Статусы, в которых кейс можно РЕДАКТИРОВАТЬ. Включает in_review намеренно:
// здесь автор и рецензент — один админ, и запрет правки в ревью создавал
// тупик (нельзя опубликовать из-за замечания и нельзя его же исправить).
// Опубликованный/архивный по-прежнему неизменяемы: правка published должна
// идти через версионирование, а не мутацию на месте.
const EDITABLE_FOR_UPDATE = ["draft", "rejected", "in_review"];

// Проверяет, что все находки ссылаются на существующий кадр.
function assertFindingsFitImages(findings, imageCount) {
  for (const f of findings ?? []) {
    if (f.imageIndex >= imageCount) {
      throw new ValidationError(
        `Находка "${f.key}" ссылается на кадр ${f.imageIndex}, а кадров всего ${imageCount}`,
      );
    }
  }
}

export async function createCase(input, actorId, actorRole) {
  if (!hasReadingSystem(input.modality)) {
    throw new ConflictError(
      `Для модальности "${input.modality}" пока нет системы чтения — доступные модальности отдаёт GET /reading-systems`,
    );
  }
  assertFindingsFitImages(input.findings, input.images.length);

  const doc = await RadiologyCase.create({
    modality: input.modality,
    title: input.title,
    clinicalContext: input.clinicalContext ?? "",
    difficulty: input.difficulty ?? "medium",
    categoryId: input.categoryId ?? null,
    tags: input.tags ?? [],
    images: input.images ?? [],
    findings: input.findings ?? [],
    plannedFindings: input.plannedFindings ?? [],
    impression: input.impression ?? {},
    source: input.source,
    deidentified: input.deidentified ?? false,
    status: "draft",
    // Метку автогенерации ставит только ночная задача — из HTTP-контроллера
    // она не приходит (в createCaseSchema поля нет).
    ...(input.autoGen ? { autoGen: input.autoGen } : {}),
    // Ссылки на снимки-кандидаты кладёт та же ночная задача сразу после
    // генерации: кейс придуман по теме, кадра к нему нет, и без подсказки,
    // где его взять, черновик так и лежит неразобранным.
    ...(input.imageSources?.length ? { imageSources: input.imageSources } : {}),
    ...(input.imageSearchAdvice ? { imageSearchAdvice: input.imageSearchAdvice } : {}),
    ...(input.imageSearchAt ? { imageSearchAt: input.imageSearchAt } : {}),
    createdBy: actorId,
  });

  recordRadiologyEvent({
    action: "case.create",
    actorId,
    actorRole,
    caseId: doc._id,
    metadata: {
      modality: doc.modality,
      findings: doc.findings.length,
      images: doc.images.length,
    },
  });

  return doc.toObject();
}

export async function updateCase(caseId, patch, actorId) {
  const doc = await RadiologyCase.findById(caseId);
  if (!doc) throw new NotFoundError("Radiology case");
  if (!EDITABLE_FOR_UPDATE.includes(doc.status)) {
    throw new ConflictError(
      `Кейс в статусе "${doc.status}" редактировать нельзя — снимите с публикации`,
    );
  }

  const images = patch.images ?? doc.images;
  const findings = patch.findings ?? doc.findings;
  assertFindingsFitImages(findings, images.length);

  const FIELDS = [
    "title",
    "clinicalContext",
    "difficulty",
    "categoryId",
    "tags",
    "images",
    "findings",
    // План находок правится вместе с кейсом: перенося находку на снимок,
    // редактор убирает её из плана — иначе чек-лист никогда бы не пустел.
    "plannedFindings",
    "impression",
    "source",
    "deidentified",
  ];
  for (const f of FIELDS) if (patch[f] !== undefined) doc[f] = patch[f];
  doc.updatedBy = actorId;
  await doc.save();
  return doc.toObject();
}

// ─── Применение машинных правок (ai/autoFix.js) ───────────────────────
//
// Третий проход правит у лучевого кейса ТОЛЬКО ТЕКСТ: название, клинический
// контекст, план находок и эталонное заключение. Разметка на кадре
// (findings с координатами), сами кадры и галочка деидентификации остаются
// нетронутыми, и это не упрощение, а единственно возможное поведение:
//
//   — точки на снимке ставит человек, который снимок ВИДЕЛ. Модель координат
//     не знает и, подвинув их «по описанию», сделала бы ложный эталон, по
//     которому потом оценивают врачей;
//   — «снимок деидентифицирован» — утверждение о реальном изображении.
//     Подписать его может только тот, кто на изображение смотрел.
//
// Отсюда же следствие, о котором сервер сообщает клиенту флагом
// markupPresent: если находки УЖЕ размечены, а редактор поменял их план,
// разметка и план могли разойтись — это должен свести человек.

/**
 * Записать в лучевой кейс результат машинной правки текстовой части.
 *
 * @returns {Promise<{case: object, markupPresent: boolean}>}
 */
export async function applyRadiologyAiRevision(caseId, draft, meta = {}) {
  const doc = await RadiologyCase.findById(caseId);
  if (!doc) throw new NotFoundError("Radiology case");
  if (!EDITABLE_FOR_UPDATE.includes(doc.status)) {
    throw new ConflictError(
      `Кейс в статусе "${doc.status}" машинной правке не подлежит — снимите его с публикации`,
    );
  }

  // Рецензенту (а значит и редактору) уходит ОБЪЕДИНЁННЫЙ список: и находки
  // из плана, и уже размеченные на кадре — ему важна медицинская суть, а не
  // координаты. Обратно этот список надо развести по двум полям, иначе
  // размеченная находка продублируется в плане «что ещё разметить».
  const incoming = (Array.isArray(draft.plannedFindings) ? draft.plannedFindings : []).slice(0, 40);
  const markedLabels = new Set((doc.findings ?? []).map((f) => f.label));

  // Уже размеченным находкам обновляем ТОЛЬКО значимость и пояснение —
  // текстовую часть, которую редактор вправе править. Координаты, кадр и
  // форма остаются как их поставил человек: это и есть эталон, по которому
  // оценивают врачей.
  const byLabel = new Map(incoming.map((f) => [f.label, f]));
  doc.findings = (doc.findings ?? []).map((f) => {
    const fixed = byLabel.get(f.label);
    if (!fixed) return f;
    return {
      ...(f.toObject?.() ?? f),
      significance: fixed.significance ?? f.significance,
      explanation:
        fixed.explanation !== undefined
          ? String(fixed.explanation).trim().slice(0, 2000)
          : f.explanation,
    };
  });

  doc.title = String(draft.title ?? doc.title).trim().slice(0, 300) || doc.title;
  doc.clinicalContext = String(draft.clinicalContext ?? "").trim().slice(0, 4000);
  if (draft.difficulty) doc.difficulty = draft.difficulty;
  doc.plannedFindings = incoming
    // Размеченное из плана убираем: план — это «что ещё предстоит поставить на
    // кадр», и находка, уже стоящая на нём, там не нужна (ровно так же ведёт
    // себя ручная правка — см. updateCase).
    .filter((f) => !markedLabels.has(f.label))
    .slice(0, 20)
    .map((f) => ({
      label: f.label,
      significance: f.significance ?? "major",
      location: String(f.location ?? "").trim().slice(0, 300),
      explanation: String(f.explanation ?? "").trim().slice(0, 2000),
    }));
  doc.impression = {
    correctText: String(draft.impression?.correctText ?? "").trim().slice(0, 4000),
    diagnosisKeys: (draft.impression?.diagnosisKeys ?? []).slice(0, 20),
    diagnosisSynonyms: (draft.impression?.diagnosisSynonyms ?? []).slice(0, 50),
  };
  doc.aiRevision = {
    rounds: meta.rounds ?? 0,
    stoppedBy: meta.stoppedBy ?? "",
    converged: Boolean(meta.converged),
    changes: meta.changes ?? [],
    disputed: meta.disputed ?? [],
    model: meta.model ?? "",
    revisedAt: new Date(),
    actorId: meta.actorId ?? null,
  };
  doc.updatedBy = meta.actorId ?? doc.updatedBy;
  await doc.save();

  return { case: doc.toObject(), markupPresent: (doc.findings?.length ?? 0) > 0 };
}

// Блокеры публикации — корректность, права и приватность.
export function collectPublishBlockers(doc) {
  const blockers = [];
  if (!doc.deidentified)
    blockers.push("снимок не подтверждён как деидентифицированный");
  if (!doc.images || doc.images.length === 0)
    blockers.push("нет ни одного кадра");
  if (["public_government", "licensed"].includes(doc.source?.kind) && !doc.source?.authority)
    blockers.push("для заимствованного материала не указан орган/издание");
  if (doc.source?.kind === "licensed" && !doc.source?.licenseNote)
    blockers.push("для лицензионного материала не указаны условия");
  if (!hasReadingSystem(doc.modality))
    blockers.push(`нет системы чтения для модальности "${doc.modality}"`);
  // Неразобранные замечания ИИ-рецензента. Блокируют ВСЕ, а не только
  // severity=error: калибровка показала, что модель систематически занижает
  // серьёзность, и промптом это не лечится. «Разобрано» ставит человек —
  // гейт требует не согласия с ИИ, а того, чтобы замечание прочитали.
  const openIssues = unresolvedAiIssues(doc.aiReview).length;
  if (openIssues)
    blockers.push(`разберите замечания ИИ-рецензента (${openIssues})`);
  return blockers;
}

export async function submitForReview(caseId, actorId, actorRole) {
  const doc = await RadiologyCase.findById(caseId);
  if (!doc) throw new NotFoundError("Radiology case");
  if (!EDITABLE.includes(doc.status)) {
    throw new ConflictError(
      `Кейс в статусе "${doc.status}" нельзя отправить на ревью`,
    );
  }
  // ВСЕ препятствия к публикации проверяем УЖЕ на входе в ревью, а не только
  // при публикации. Иначе кейс уходит в «in_review» (где редактировать уже
  // нельзя) с незакрытым замечанием — и застревает: опубликовать нельзя,
  // поправить нельзя. Так гейт срабатывает, пока кейс ещё черновик.
  const blockers = collectPublishBlockers(doc);
  if (blockers.length) {
    throw new ValidationError(
      `Перед отправкой на ревью устраните: ${blockers.join("; ")}`,
      { blockers },
    );
  }
  doc.status = "in_review";
  doc.rejectionReason = null;
  await doc.save();
  recordRadiologyEvent({
    action: "case.submit",
    actorId,
    actorRole,
    caseId: doc._id,
  });
  return doc.toObject();
}

export async function reviewCase(caseId, { decision, reason }, actorId, actorRole) {
  const doc = await RadiologyCase.findById(caseId);
  if (!doc) throw new NotFoundError("Radiology case");
  if (doc.status !== "in_review") {
    throw new ConflictError(
      `Ревью возможно только для кейса на ревью (сейчас "${doc.status}")`,
    );
  }

  if (decision === "reject") {
    if (!reason?.trim())
      throw new ValidationError("Укажите причину отклонения — она вернётся автору");
    doc.status = "rejected";
    doc.rejectionReason = reason.trim();
    doc.reviewedBy = actorId;
    doc.reviewedAt = new Date();
    await doc.save();
    recordRadiologyEvent({
      action: "case.reject",
      actorId,
      actorRole,
      caseId: doc._id,
    });
    return doc.toObject();
  }

  // approve — гейт публикации. Причины кладём прямо в текст ошибки: иначе
  // оператор видит глухое «Опубликовать нельзя» и не знает, что чинить.
  const blockers = collectPublishBlockers(doc);
  if (blockers.length) {
    throw new ValidationError(`Опубликовать нельзя: ${blockers.join("; ")}`, {
      blockers,
    });
  }
  doc.status = "published";
  doc.reviewedBy = actorId;
  doc.reviewedAt = new Date();
  doc.publishedAt = doc.publishedAt ?? new Date();
  doc.rejectionReason = null;
  await doc.save();
  // Перевод на остальные языки — после публикации и не в этом запросе.
  scheduleCaseTranslation("radiology", doc._id, { actorId });

  recordRadiologyEvent({
    action: "case.publish",
    actorId,
    actorRole,
    caseId: doc._id,
    metadata: { modality: doc.modality, findings: doc.findings.length },
  });
  return doc.toObject();
}

export async function archiveCase(caseId, actorId, actorRole) {
  const doc = await RadiologyCase.findById(caseId);
  if (!doc) throw new NotFoundError("Radiology case");
  doc.status = "archived";
  await doc.save();
  recordRadiologyEvent({
    action: "case.archive",
    actorId,
    actorRole,
    caseId: doc._id,
  });
  return doc.toObject();
}

// Удаление НАСОВСЕМ — в отличие от archiveCase, который лишь меняет статус.
// Нужно владельцу проекта: ночной автогенератор приносит кейсы пачками, и
// неудачные должны исчезать бесследно, а не копиться в архиве.
//
// Два предохранителя, и оба не косметические:
//   1. Опубликованный кейс не удаляется. Сначала архив — это осознанное
//      второе действие, а не случайный клик по строке каталога.
//   2. Кейс с попытками не удаляется НИКОГДА. На caseId ссылаются попытки,
//      дуэли, очередь работы над ошибками и статистика; удалив его, мы
//      оставили бы врачам разборы, ведущие в никуда. Для таких — архив.
export async function deleteCasePermanently(caseId, actorId, actorRole) {
  const doc = await RadiologyCase.findById(caseId);
  if (!doc) throw new NotFoundError("Radiology case");
  if (doc.status === "published") {
    throw new ConflictError(
      "Опубликованный кейс сначала уберите в архив — удалять то, что видят врачи, нельзя",
    );
  }

  const attempts = await RadiologyAttempt.countDocuments({ caseId: doc._id });
  if (attempts > 0) {
    throw new ConflictError(
      `По кейсу есть попытки врачей (${attempts}) — на него ссылаются разборы и статистика. Уберите его в архив вместо удаления.`,
    );
  }

  // Переводы живут отдельной коллекцией и на удаление кейса сами не реагируют:
  // без этой уборки они остались бы сиротами с уникальным индексом на caseId.
  await ArenaCaseTranslation.deleteMany({ caseType: "radiology", caseId: doc._id });
  await RadiologyCase.deleteOne({ _id: doc._id });

  // Запись в доменный аудит переживает сам кейс — это и есть след того, что
  // материал был и кто его убрал. Только структурные данные, как везде.
  recordRadiologyEvent({
    action: "case.delete",
    actorId,
    actorRole,
    caseId: doc._id,
    metadata: {
      modality: doc.modality,
      status: doc.status,
      auto: Boolean(doc.autoGen?.isAuto),
      topicKey: doc.autoGen?.topicKey || null,
    },
  });

  return { deleted: true, id: String(doc._id) };
}

// lang задаётся для учащегося и НЕ задаётся для редактора: в админке нужны
// исходные названия, иначе редактор правит один текст, а видит другой.
export async function listCases({ filters, isEditor, lang = null }) {
  const query = {};
  if (filters.modality) query.modality = filters.modality;
  if (filters.difficulty) query.difficulty = filters.difficulty;

  // Учащийся видит только опубликованное. Редактор с scope=all — все
  // статусы, иначе тоже опубликованные.
  if (isEditor && filters.scope === "all") {
    if (filters.status) query.status = filters.status;
  } else {
    query.status = "published";
  }

  // Поиск по названию считает база. Раньше его не было вовсе, и фильтровать
  // приходилось на клиенте — то есть только по той части каталога, которая
  // доехала. Со страницей в 24 кейса это перестало бы работать сразу.
  const byTitle = titleFilter(filters.q);
  if (byTitle) Object.assign(query, byTitle);

  const page = await paginate(RadiologyCase, {
    query,
    // Список без эталона в любом случае. План находок — тоже «ключ ответа»
    // (он прямо называет патологию), и в каталоге он не нужен.
    select: "-findings -impression -plannedFindings",
    skip: filters.skip,
    limit: filters.limit,
  });

  page.items = await translateCaseList("radiology", page.items, lang);
  return page;
}

// Полный кейс — только редактору (для авторинга/ревью).
export async function getCaseFull(caseId) {
  const doc = await RadiologyCase.findById(caseId).lean();
  if (!doc) throw new NotFoundError("Radiology case");
  return { ...doc, publishBlockers: collectPublishBlockers(doc) };
}

// Санитизованный кейс для учащегося: без эталона находок и заключения,
// но с конфигурацией системы чтения и палитрой находок для разметки.
export async function getCaseForLearner(
  caseId,
  { allowUnpublished = false, lang = null } = {},
) {
  const doc = await RadiologyCase.findById(caseId).lean();
  if (!doc) throw new NotFoundError("Radiology case");
  if (doc.status !== "published" && !allowUnpublished) {
    throw new NotFoundError("Radiology case");
  }
  // Открытие кейса — то место, где перевод догоняется по требованию: здесь
  // ждать несколько секунд допустимо, а к моменту старта попытки перевод уже
  // лежит в базе и достаётся мгновенно.
  return sanitizeForLearner(
    await translatedCaseFor("radiology", doc, lang, { lazy: true }),
  );
}

export function sanitizeForLearner(doc) {
  const rs = getReadingSystem(doc.modality);
  return {
    _id: doc._id,
    modality: doc.modality,
    title: doc.title,
    clinicalContext: doc.clinicalContext,
    difficulty: doc.difficulty,
    tags: doc.tags,
    images: (doc.images ?? []).map((img) => ({
      url: img.url,
      order: img.order,
      label: img.label,
      width: img.width,
      height: img.height,
      pixelSpacingMm: img.pixelSpacingMm,
    })),
    readingSystem: rs
      ? {
          modality: rs.modality,
          title: rs.title,
          description: rs.description,
          viewer: rs.viewer,
          checklist: rs.checklist,
          passThreshold: rs.scoring.passThreshold,
        }
      : null,
    // Палитра ярлыков находок, из которых учащийся выбирает при разметке.
    findingPalette: findingsForModality(doc.modality),
  };
}

// Инкрементально обновляет статистику кейса после сдачи попытки. Средний
// балл считается только по первым зачётным попыткам — см. caseStats.service.
export async function recordAttemptStats(caseId, totalScore, opts = {}) {
  await recordCaseStats({
    CaseModel: RadiologyCase,
    caseId,
    total: totalScore,
    isFirstCounted: Boolean(opts.isFirstCounted),
    durationMs: opts.durationMs ?? null,
  });
}
