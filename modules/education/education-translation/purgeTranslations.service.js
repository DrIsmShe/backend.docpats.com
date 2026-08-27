// server/modules/education/education-translation/purgeTranslations.service.js
//
// Снятие переводов с теста: он снова становится одноязычным.
//
// ЗАЧЕМ. Раскладка витрины поменялась: язык курса — обычная рубрика каталога,
// и в каждую кладётся свой тест, написанный сразу на нужном языке
// (см. constants → isAutoTranslateEnabled). Тесты, переведённые до этого
// решения, остаются пятиязычными: у них в банке лежат вопросы-переводы, а
// значит ExamProgram.languages содержит все пять, и тест находится фильтром на
// каждом из них — даже лёжа в рубрике одного языка.
//
// ЧТО СНИМАЕТСЯ:
//   - вопросы-переводы (ExamItem с заполненным translationOf) — удаляются;
//   - переводы названия и описания теста (ExamProgram.translations) — стираются;
//   - languages пересобирается по оставшемуся банку, primaryLang фиксируется.
//
// ЧТО НЕ ТРОГАЕТСЯ: оригиналы вопросов. Их ровно столько же, сколько было до
// перевода, и ни один не меняется — перевод всегда был ОТДЕЛЬНЫМ документом.
//
// ПОПЫТКИ — единственное место, где решение не очевидно, и поэтому оно не
// принимается за человека. ExamAttempt.questions хранит СНИМОК состава: ссылки
// на конкретные вопросы. Удалив перевод, мы осиротим ссылки в попытках,
// пройденных на нём. Варианта два, и оба законны:
//
//   keep   — попытки остаются. Их итоговый балл уже посчитан и хранится, но
//            разбор покажет меньше вопросов, чем было: getAttemptForLearner
//            отбрасывает ненайденные (`.filter(Boolean)`). История сдач цела,
//            выглядит неполной.
//   delete — попытки удаляются вместе с переводами. Разбор не врёт, но из
//            статистики врача пропадает то, что он действительно проходил.
//
// Поэтому purge требует явного выбора, а не подставляет умолчание.

import ExamItem from "../education-items/models/examItem.model.js";
import ExamProgram from "../education-catalog/models/examProgram.model.js";
import ExamAttempt from "../education-attempts/models/examAttempt.model.js";
import {
  recountPublishedItems,
  resolveProgramSourceLang,
} from "../education-catalog/services/program.service.js";
import { NotFoundError, ValidationError } from "../../../common/utils/errors.js";
import logger from "../../../common/logger.js";

export const ATTEMPT_POLICIES = ["keep", "delete"];

/**
 * Отчёт о том, что будет снято. Ничего не меняет — им пользуется и сухой
 * прогон, и сам purge перед записью.
 */
export async function inspectProgramTranslations(programId) {
  const program = await ExamProgram.findById(programId).lean();
  if (!program) throw new NotFoundError("Exam program");

  const [originals, translations] = await Promise.all([
    ExamItem.countDocuments({ programId, translationOf: null }),
    ExamItem.find({ programId, translationOf: { $ne: null } })
      .select("_id lang")
      .lean(),
  ]);

  const byLang = new Map();
  for (const it of translations) {
    byLang.set(it.lang, (byLang.get(it.lang) ?? 0) + 1);
  }

  const translationIds = translations.map((t) => t._id);
  // Попытки, в чей снимок состава попал хоть один переводной вопрос.
  const affectedAttempts = translationIds.length
    ? await ExamAttempt.countDocuments({
        programId,
        "questions.itemId": { $in: translationIds },
      })
    : 0;

  return {
    program: {
      _id: program._id,
      title: program.title,
      status: program.status,
      languages: program.languages ?? [],
      primaryLang: program.primaryLang ?? null,
      titleTranslations: (program.translations ?? []).map((t) => t.lang),
    },
    originalCount: originals,
    translationCount: translations.length,
    translationsByLang: Object.fromEntries(byLang),
    translationIds,
    affectedAttempts,
  };
}

/**
 * Снять переводы. Возвращает тот же отчёт плюс что фактически сделано.
 *
 * @param {string} programId
 * @param {object} opts
 * @param {"keep"|"delete"} opts.attempts — что делать с попытками, пройденными
 *   на переводах. Обязателен, если такие попытки есть.
 */
export async function purgeProgramTranslations(programId, { attempts } = {}) {
  const report = await inspectProgramTranslations(programId);

  if (report.affectedAttempts > 0) {
    if (!ATTEMPT_POLICIES.includes(attempts)) {
      throw new ValidationError(
        `На переводах этого теста пройдено попыток: ${report.affectedAttempts}. ` +
          `Укажите, что с ними делать: attempts="keep" или attempts="delete".`,
      );
    }
  }

  let deletedAttempts = 0;
  if (report.translationIds.length > 0) {
    // Попытки удаляем ДО вопросов: иначе при обрыве посередине останутся
    // попытки со ссылками в никуда, и повторный прогон их уже не найдёт —
    // вопросов, по которым он их ищет, больше нет.
    if (attempts === "delete" && report.affectedAttempts > 0) {
      const res = await ExamAttempt.deleteMany({
        programId,
        "questions.itemId": { $in: report.translationIds },
      });
      deletedAttempts = res.deletedCount ?? 0;
    }

    await ExamItem.deleteMany({ _id: { $in: report.translationIds } });
  }

  // Переводы названия — часть той же многоязычности, снимаем вместе с банком.
  // primaryLang считаем ПОСЛЕ удаления: теперь оригиналы остались одни, и
  // resolveProgramSourceLang назовёт язык теста однозначно.
  const fresh = await ExamProgram.findById(programId);
  const sourceLang = await resolveProgramSourceLang(fresh);
  fresh.translations = [];
  fresh.primaryLang = sourceLang;
  await fresh.save();

  // Пересобираем languages и счётчик по тому, что осталось.
  await recountPublishedItems(programId);
  const after = await ExamProgram.findById(programId)
    .select("languages primaryLang publishedItemCount translations")
    .lean();

  logger?.info?.(
    {
      programId: String(programId),
      removedItems: report.translationIds.length,
      deletedAttempts,
      languages: after.languages,
    },
    "exam program translations purged",
  );

  return {
    ...report,
    removedItems: report.translationIds.length,
    deletedAttempts,
    after: {
      languages: after.languages ?? [],
      primaryLang: after.primaryLang ?? null,
      publishedItemCount: after.publishedItemCount ?? 0,
      titleTranslations: (after.translations ?? []).length,
    },
  };
}
