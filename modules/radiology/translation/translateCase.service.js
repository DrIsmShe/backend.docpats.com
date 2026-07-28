// server/modules/radiology/translation/translateCase.service.js
//
// Перевод учебного кейса на остальные языки. Общий для трёх станций.
//
// Правила «трогать / не трогать» те же, что в банке вопросов, и по тем же
// причинам:
//   выправленный человеком перевод не перезаписывается автопереводом даже по
//     кнопке «заново» — ручная работа дороже машинной;
//   свежий (хеш совпал) не переводится повторно — это просто трата денег;
//   языки независимы: отказ модели на арабском не лишает врача турецкого.

import ArenaCaseTranslation, {
  ARENA_CASE_TYPES,
  ARENA_LANGUAGES,
} from "./arenaCaseTranslation.model.js";
import {
  collectCaseFields,
  collectDiagnosisSets,
  sourceHashOf,
} from "./caseFields.js";
import { translateCaseContent } from "./caseTranslator.js";
import { NotFoundError, ValidationError } from "../../../common/utils/errors.js";
import logger from "../../../common/logger.js";

/** Модель кейса по станции. Импорт ленивый — модули тянут друг друга. */
async function modelFor(caseType) {
  if (caseType === "radiology") {
    return (await import("../radiology-cases/models/radiologyCase.model.js")).default;
  }
  if (caseType === "labs") {
    return (await import("../labs-station/models/labCase.model.js")).default;
  }
  if (caseType === "vp") {
    return (await import("../virtual-patient/models/vpCase.model.js")).default;
  }
  throw new ValidationError(`Unknown case type "${caseType}"`);
}

function decideAction(existing, hash, { force = false } = {}) {
  if (!existing) return "create";
  if (existing.status === "reviewed") return "skip_reviewed";
  if (force) return "update";
  if (existing.sourceHash === hash) return "skip_fresh";
  return "update";
}

/**
 * Переводит кейс на указанные языки.
 *
 * @param {"radiology"|"labs"|"vp"} caseType
 * @param {string} caseId
 * @param {object} [p]
 * @param {string[]} [p.langs]  по умолчанию — все, кроме языка оригинала
 * @param {boolean} [p.force]
 * @param {string}  [p.actorId]
 */
export async function translateCase(caseType, caseId, { langs = null, force = false, actorId = null } = {}) {
  if (!ARENA_CASE_TYPES.includes(caseType)) {
    throw new ValidationError(`Unknown case type "${caseType}"`);
  }

  const Model = await modelFor(caseType);
  const doc = await Model.findById(caseId).lean();
  if (!doc) throw new NotFoundError("Case");

  const sourceLang = doc.lang ?? "ru";
  const targets = (langs?.length ? langs : ARENA_LANGUAGES).filter(
    (l) => l !== sourceLang && ARENA_LANGUAGES.includes(l),
  );
  if (!targets.length) throw new ValidationError("No target languages");

  const fields = collectCaseFields(caseType, doc);
  const diagnosis = collectDiagnosisSets(caseType, doc);
  const hash = sourceHashOf(caseType, doc);

  const existing = await ArenaCaseTranslation.find({ caseType, caseId: doc._id }).lean();
  const byLang = new Map(existing.map((r) => [r.lang, r]));

  const report = { caseType, caseId: String(doc._id), created: [], updated: [], skipped: [], failed: [] };

  for (const lang of targets) {
    const action = decideAction(byLang.get(lang), hash, { force });
    if (action === "skip_reviewed" || action === "skip_fresh") {
      report.skipped.push({ lang, reason: action });
      continue;
    }

    try {
      const translated = await translateCaseContent({
        targetLang: lang,
        sourceLang,
        fields,
        diagnosisKeys: diagnosis.diagnosisKeys,
        diagnosisSynonyms: diagnosis.diagnosisSynonyms,
      });

      await ArenaCaseTranslation.findOneAndUpdate(
        { caseType, caseId: doc._id, lang },
        {
          $set: {
            sourceLang,
            fields: Object.entries(translated.fields).map(([path, text]) => ({ path, text })),
            diagnosisKeys: translated.diagnosisKeys,
            diagnosisSynonyms: translated.diagnosisSynonyms,
            status: "auto",
            sourceHash: hash,
            model: translated.model,
            promptVersion: translated.promptVersion,
            updatedBy: actorId,
          },
          $setOnInsert: { createdBy: actorId },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );

      report[action === "create" ? "created" : "updated"].push({ lang });
    } catch (err) {
      logger?.warn?.(
        { err, caseType, caseId: String(doc._id), lang },
        "arena case translation failed",
      );
      report.failed.push({ lang, message: err?.message ?? "translation failed" });
    }
  }

  logger?.info?.(
    {
      caseType,
      caseId: String(doc._id),
      created: report.created.length,
      updated: report.updated.length,
      skipped: report.skipped.length,
      failed: report.failed.length,
    },
    "arena case translated",
  );

  return report;
}

/** Состояние переводов кейса — для админки. */
export async function listCaseTranslations(caseType, caseId) {
  const Model = await modelFor(caseType);
  const doc = await Model.findById(caseId).lean();
  if (!doc) throw new NotFoundError("Case");

  const sourceLang = doc.lang ?? "ru";
  const hash = sourceHashOf(caseType, doc);
  const rows = await ArenaCaseTranslation.find({ caseType, caseId: doc._id }).lean();
  const byLang = new Map(rows.map((r) => [r.lang, r]));

  return {
    caseType,
    caseId: String(doc._id),
    sourceLang,
    languages: ARENA_LANGUAGES.filter((l) => l !== sourceLang).map((lang) => {
      const row = byLang.get(lang);
      if (!row) return { lang, status: "missing" };
      return {
        lang,
        status:
          row.status === "reviewed"
            ? "reviewed"
            : row.sourceHash === hash
              ? "auto"
              : "stale",
        // Показываем редактору именно то, чем проверяется ответ: если тут
        // пусто или неверно, врач на этом языке не получит балл за диагноз, а
        // по самому тексту кейса это никак не видно.
        diagnosisKeys: row.diagnosisKeys,
        diagnosisSynonyms: row.diagnosisSynonyms,
        fields: Object.fromEntries((row.fields ?? []).map((f) => [f.path, f.text])),
        updatedAt: row.updatedAt,
      };
    }),
  };
}

/**
 * Ручная правка перевода. Помечает его «проверено».
 *
 * diagnosisKeys правятся отдельно от текста намеренно: это не оформление, а
 * то, с чем сверяется ответ. Редактор должен понимать, что меняет условие
 * зачёта, а не формулировку.
 */
export async function updateCaseTranslation(
  caseType,
  caseId,
  lang,
  { fields = null, diagnosisKeys = null, diagnosisSynonyms = null, actorId = null },
) {
  const doc = await ArenaCaseTranslation.findOne({ caseType, caseId, lang });
  if (!doc) throw new NotFoundError("Translation");

  if (fields && typeof fields === "object") {
    for (const [path, value] of Object.entries(fields)) {
      if (typeof value !== "string" || !value.trim()) continue;
      const row = doc.fields.find((f) => f.path === path);
      if (row) row.text = value.trim();
      else doc.fields.push({ path, text: value.trim() });
    }
  }
  if (Array.isArray(diagnosisKeys)) {
    const cleaned = diagnosisKeys.map((t) => String(t).trim()).filter(Boolean);
    if (!cleaned.length) {
      throw new ValidationError(
        "Список принятых диагнозов не может быть пустым: иначе на этом языке балл за диагноз не получит никто",
      );
    }
    doc.diagnosisKeys = cleaned;
  }
  if (Array.isArray(diagnosisSynonyms)) {
    doc.diagnosisSynonyms = diagnosisSynonyms.map((t) => String(t).trim()).filter(Boolean);
  }

  doc.status = "reviewed";
  doc.updatedBy = actorId;
  await doc.save();
  return doc.toObject();
}

/** Снять «проверено», чтобы автоперевод снова мог обновлять текст. */
export async function unreviewCaseTranslation(caseType, caseId, lang, { actorId = null } = {}) {
  const doc = await ArenaCaseTranslation.findOneAndUpdate(
    { caseType, caseId, lang },
    { $set: { status: "auto", updatedBy: actorId } },
    { new: true },
  ).lean();
  if (!doc) throw new NotFoundError("Translation");
  return doc;
}
