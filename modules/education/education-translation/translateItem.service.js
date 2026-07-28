// server/modules/education/education-translation/translateItem.service.js
//
// Перевод опубликованного вопроса на остальные языки программы.
//
// УСТРОЙСТВО. Перевод — это отдельный документ ExamItem с другим lang и
// ссылкой translationOf на оригинал. Так модуль задуман с самого начала:
// сборка сессии уже фильтрует вопросы по языку
//
//     if (lang) match.lang = lang;              // attempt.service.js
//
// поэтому созданный перевод попадает врачу без единой правки на пути выдачи.
// Альтернатива — держать переводы полями внутри одного документа — потребовала
// бы переписать выборку, статистику и блоки, и при этом сломала бы уже
// работающий отбор по языку.
//
// ЧТО КОПИРУЕТСЯ ДОСЛОВНО. Всё, что не текст для чтения: correctKeys, ключи
// вариантов, тип, сложность, тема, программа, происхождение, ссылки,
// изображения. Ответ проверяется по ключу варианта, а не по его тексту, —
// значит перевод физически не может изменить, какой ответ верен. Это главное
// свойство здешней схемы, и ради него стоит терпеть отдельные документы.
//
// Названия источников (references[].title) тоже НЕ переводятся: это выходные
// данные реальной статьи, а переведённое название невозможно найти.

import ExamItem from "../education-items/models/examItem.model.js";
import { translateItemContent } from "./translator.js";
import { EXAM_LANGUAGES } from "../constants.js";
import { recountPublishedItems } from "../education-catalog/services/program.service.js";
import { NotFoundError, ValidationError } from "../../../common/utils/errors.js";
import logger from "../../../common/logger.js";

/** Языки, на которые переводим вопрос: все поддерживаемые, кроме его родного. */
export function targetLanguagesFor(item, requested = null) {
  const all = requested?.length ? requested : EXAM_LANGUAGES;
  return all.filter((l) => l !== item.lang && EXAM_LANGUAGES.includes(l));
}

/**
 * Нужно ли трогать перевод.
 *
 * Три причины не трогать, и порядок важен:
 *   1. перевод выправлен человеком — ручная работа дороже машинной, и
 *      затирать её автопереводом нельзя даже ради свежести;
 *   2. перевод сделан с текущей версии оригинала — он не устарел;
 *   3. force снимает пункт 2, но НЕ пункт 1: «перевести заново» в админке не
 *      должно втихую стирать чужую правку. Для этого есть отдельная кнопка,
 *      которая сначала снимает отметку «проверено».
 */
function decideAction(existing, source, { force = false } = {}) {
  if (!existing) return "create";
  if (existing.translationStatus === "reviewed") return "skip_reviewed";
  if (force) return "update";
  if (existing.translationSourceVersion === source.version) return "skip_fresh";
  return "update";
}

/** Поля, которые перевод берёт у оригинала без изменений. */
function inheritedFields(source) {
  return {
    programId: source.programId,
    topicCode: source.topicCode,
    type: source.type,
    // Ключевое: набор верных ключей копируется как есть.
    correctKeys: [...(source.correctKeys ?? [])],
    difficulty: source.difficulty,
    tags: [...(source.tags ?? [])],
    source: source.source,
    references: source.references,
    stemImageUrl: source.stemImageUrl,
    // Статус повторяет оригинал: перевод опубликованного вопроса виден сразу,
    // с пометкой «автоперевод» на фронте. Перевод неопубликованного не должен
    // обгонять оригинал и попасть врачу раньше него.
    status: source.status,
    publishedAt: source.publishedAt,
    reviewedBy: source.reviewedBy,
    reviewedAt: source.reviewedAt,
  };
}

/**
 * Переводит вопрос на указанные языки.
 *
 * Языки обрабатываются независимо: отказ модели на арабском не должен лишать
 * врача турецкой версии. Поэтому ошибка по языку копится в отчёт, а не
 * прерывает остальные.
 *
 * @param {string} itemId
 * @param {object} p
 * @param {string[]} [p.langs]   по умолчанию — все, кроме языка оригинала
 * @param {boolean}  [p.force]   переводить заново даже свежий (кроме проверенных)
 * @param {string}   [p.actorId]
 */
export async function translateItem(itemId, { langs = null, force = false, actorId = null } = {}) {
  const source = await ExamItem.findById(itemId).lean();
  if (!source) throw new NotFoundError("Exam item");
  if (source.translationOf) {
    throw new ValidationError("Cannot translate a translation — translate the source item");
  }

  const targets = targetLanguagesFor(source, langs);
  if (!targets.length) throw new ValidationError("No target languages");

  const existing = await ExamItem.find({ translationOf: source._id }).lean();
  const byLang = new Map(existing.map((d) => [d.lang, d]));

  const report = { itemId: String(source._id), created: [], updated: [], skipped: [], failed: [] };

  for (const lang of targets) {
    const action = decideAction(byLang.get(lang), source, { force });
    if (action === "skip_reviewed" || action === "skip_fresh") {
      report.skipped.push({ lang, reason: action });
      continue;
    }

    try {
      const translated = await translateItemContent({ item: source, targetLang: lang });

      // Варианты собираются ПО ОРИГИНАЛУ, а не по ответу переводчика: порядок
      // и набор ключей задаёт исходный вопрос, перевод даёт только тексты.
      //
      // Переводчик это тоже проверяет, но полагаться здесь на его добросовестность
      // нельзя: правка в translator.js не должна иметь возможности молча
      // переставить варианты в банке. Порядок бывает значим — «Ничего из
      // перечисленного» принято держать последним, — а перепутанные ключи
      // означают вопрос, где верный ответ указывает не туда.
      const translatedByKey = new Map(translated.options.map((o) => [o.key, o.text]));
      const missing = (source.options ?? [])
        .filter((o) => !String(translatedByKey.get(o.key) ?? "").trim())
        .map((o) => o.key);
      if (missing.length) {
        throw new ValidationError(
          `Перевод не вернул варианты: ${missing.join(", ")}`,
        );
      }
      const options = (source.options ?? []).map((o) => ({
        key: o.key,
        text: translatedByKey.get(o.key),
        imageUrl: o.imageUrl ?? null,
      }));

      const payload = {
        ...inheritedFields(source),
        lang,
        stem: translated.stem,
        options,
        explanation: translated.explanation,
        translationOf: source._id,
        translationSourceVersion: source.version,
        translationStatus: "auto",
        translationModel: translated.model,
        translationPromptVersion: translated.promptVersion,
        updatedBy: actorId,
      };

      const saved = await ExamItem.findOneAndUpdate(
        { translationOf: source._id, lang },
        { $set: payload, $setOnInsert: { createdBy: actorId } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      ).lean();

      report[action === "create" ? "created" : "updated"].push({
        lang,
        id: String(saved._id),
      });
    } catch (err) {
      logger?.warn?.(
        { err, itemId: String(source._id), lang },
        "exam item translation failed",
      );
      report.failed.push({ lang, message: err?.message ?? "translation failed" });
    }
  }

  // Пересчёт витрины программы. Нужен именно здесь, а не только при
  // публикации: languages собирается по языкам вопросов банка, и до появления
  // переводов тест числится русским. Без этого вызова каталог показывал бы
  // одноязычный тест, вопросы к которому уже есть на пяти языках, и фильтр по
  // языку его бы не находил.
  if (report.created.length || report.updated.length) {
    try {
      await recountPublishedItems(source.programId);
    } catch (err) {
      logger?.warn?.(
        { err, programId: String(source.programId) },
        "failed to recount program after translation",
      );
    }
  }

  logger?.info?.(
    {
      itemId: String(source._id),
      created: report.created.length,
      updated: report.updated.length,
      skipped: report.skipped.length,
      failed: report.failed.length,
    },
    "exam item translated",
  );

  return report;
}

/**
 * Состояние переводов вопроса — для админки.
 *
 * Отдаёт строку на каждый язык, включая те, где перевода ещё нет: пустая
 * строка со статусом "missing" информативнее, чем отсутствие строки, — сразу
 * видно, чего не хватает.
 */
export async function listTranslations(itemId) {
  const source = await ExamItem.findById(itemId).lean();
  if (!source) throw new NotFoundError("Exam item");

  const rows = await ExamItem.find({ translationOf: source._id })
    .select("lang stem options explanation translationStatus translationSourceVersion translationModel updatedAt")
    .lean();
  const byLang = new Map(rows.map((r) => [r.lang, r]));

  return {
    sourceId: String(source._id),
    sourceLang: source.lang,
    sourceVersion: source.version,
    languages: targetLanguagesFor(source).map((lang) => {
      const row = byLang.get(lang);
      if (!row) return { lang, status: "missing" };
      return {
        lang,
        id: String(row._id),
        status:
          row.translationStatus === "reviewed"
            ? "reviewed"
            : row.translationSourceVersion === source.version
              ? "auto"
              : "stale",
        stem: row.stem,
        options: row.options,
        explanation: row.explanation,
        model: row.translationModel,
        updatedAt: row.updatedAt,
      };
    }),
  };
}

/**
 * Правка перевода человеком. Любая ручная правка переводит его в "reviewed" —
 * дальше автоперевод его не трогает.
 *
 * Ключи вариантов и correctKeys здесь править нельзя: они принадлежат
 * оригиналу. Редактор перевода меняет только тексты.
 */
export async function updateTranslation(translationId, { stem, options, explanation, actorId }) {
  const doc = await ExamItem.findById(translationId);
  if (!doc) throw new NotFoundError("Translation");
  if (!doc.translationOf) {
    throw new ValidationError("Not a translation — edit the source item instead");
  }

  if (typeof stem === "string" && stem.trim()) doc.stem = stem.trim();
  if (typeof explanation === "string") doc.explanation = explanation.trim();

  if (Array.isArray(options)) {
    const byKey = new Map(options.map((o) => [o.key, o.text]));
    const unknown = [...byKey.keys()].filter(
      (k) => !doc.options.some((o) => o.key === k),
    );
    if (unknown.length) {
      throw new ValidationError("Unknown option keys", { keys: unknown });
    }
    for (const option of doc.options) {
      const text = byKey.get(option.key);
      if (typeof text === "string" && text.trim()) option.text = text.trim();
    }
  }

  doc.translationStatus = "reviewed";
  doc.updatedBy = actorId ?? doc.updatedBy;
  await doc.save();
  return doc.toObject();
}

/** Снять отметку «проверено», чтобы автоперевод снова мог обновлять текст. */
export async function unreviewTranslation(translationId, { actorId = null } = {}) {
  const doc = await ExamItem.findOneAndUpdate(
    { _id: translationId, translationOf: { $ne: null } },
    { $set: { translationStatus: "auto", updatedBy: actorId } },
    { new: true },
  ).lean();
  if (!doc) throw new NotFoundError("Translation");
  return doc;
}
