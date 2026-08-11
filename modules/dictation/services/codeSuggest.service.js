// server/modules/dictation/services/codeSuggest.service.js
//
// Подсказка кодов МКБ к надиктованному диагнозу.
//
// ГРАНИЦА, КОТОРУЮ НЕЛЬЗЯ РАЗМЫВАТЬ. Здесь ничего не проставляется автоматически
// в запись: код уходит в статистику и в счета, и «уверенность модели» не тот
// уровень доказательства, на котором такое решение принимают. Врач выбирает из
// предложенного, система только предлагает. Та же граница, что в
// modules/diagnostics (advisory: true) и в самой надиктовке, где код
// извлекается лишь при однозначном соответствии.
//
// ЧТО ДЕЛАЕТСЯ:
//   1. Врач назвал код вслух → подставляем официальное НАЗВАНИЕ этого кода.
//      Раньше codeTitle оставался пустым: sinks/myClinic.sink.js сознательно
//      не писал туда речь врача, а справочника, откуда взять официальное
//      название, в проекте не было. Теперь есть.
//   2. Кода нет, но диагноз назван → ищем кандидатов и отдаём врачу списком.
//
// ПОЧЕМУ ИЩЕМ ПО ДВУМ СТРОКАМ. Справочник англоязычный, переводы догружаются
// постепенно. Поиск только по русскому тексту нашёл бы лишь переведённую часть
// (сейчас это несколько процентов). Поэтому модель структурирования отдаёт
// служебное поле mainDiagnosisTermEn — английский термин диагноза, — и поиск
// идёт по нему тоже. Врачу это поле не показывается.

import {
  searchCodes,
  getCode,
} from "../../medicalCodes/services/codeSearch.service.js";
import { CODE_SYSTEMS } from "../../medicalCodes/models/medicalCode.model.js";
import logger from "../../../common/logger.js";

// Сколько кандидатов показывать. Больше пяти — список, который врач не читает,
// а пролистывает; меньше трёх — риск не показать нужный.
const MAX_SUGGESTIONS = 5;

/**
 * Обогащает черновик подсказками кодов.
 *
 * Возвращает НОВЫЙ объект черновика; исходный не меняется. Ошибки справочника
 * не пробрасываются: надиктовка ценна сама по себе, и падать из-за того, что
 * не подобрался код, она не должна.
 *
 * @param {object} draft   черновик от структурирующей модели
 * @param {string} locale  язык врача — на нём показываются названия
 * @returns {Promise<object>} черновик с mainDiagnosisCodeTitle и codeSuggestions
 */
export async function enrichDraftWithCodes(draft, locale = "ru") {
  if (!draft) return draft;

  const enriched = { ...draft };

  try {
    // ── 1. Код назван врачом: подставляем официальное название ──────────────
    if (draft.mainDiagnosisCode) {
      const found = await getCode({
        code: draft.mainDiagnosisCode,
        system: CODE_SYSTEMS.ICD10CM,
        locale,
      });

      if (found) {
        enriched.mainDiagnosisCodeTitle = found.title;
        // Кандидатов не ищем: код уже есть, и список рядом с ним только
        // сбивал бы — врач начал бы выбирать заново то, что уже сказал.
        return enriched;
      }

      // Код назван, но в справочнике его нет. Не молчим: это либо опечатка
      // распознавания ("Джей 35 ноль один"), либо код из другой ревизии.
      // Врач должен увидеть, что подстановка не сработала.
      enriched.mainDiagnosisCodeUnknown = true;
    }

    // ── 2. Кода нет: ищем кандидатов по тексту диагноза ─────────────────────
    const queries = [draft.mainDiagnosisText, draft.mainDiagnosisTermEn].filter(
      (value) => typeof value === "string" && value.trim().length >= 3,
    );

    if (queries.length === 0) return enriched;

    const seen = new Set();
    const suggestions = [];

    for (const query of queries) {
      if (suggestions.length >= MAX_SUGGESTIONS) break;

      const { items } = await searchCodes({
        query,
        system: CODE_SYSTEMS.ICD10CM,
        locale,
        limit: MAX_SUGGESTIONS,
      });

      for (const item of items) {
        if (suggestions.length >= MAX_SUGGESTIONS) break;
        if (seen.has(item.code)) continue;
        seen.add(item.code);
        suggestions.push({
          code: item.code,
          title: item.title,
          titleEn: item.titleEn,
        });
      }
    }

    if (suggestions.length > 0) {
      enriched.codeSuggestions = suggestions;
    }
  } catch (err) {
    // Справочник недоступен или пуст — отдаём черновик как есть.
    logger?.warn?.(
      { err: err.message },
      "dictation: подсказки кодов не сформированы",
    );
  }

  return enriched;
}

export default enrichDraftWithCodes;
