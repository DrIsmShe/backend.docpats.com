// server/modules/education/education-ingest/extractors/manual.extractor.js
//
// Ручной экстрактор: вопросы уже разобраны на стороне оператора (выгрузка
// из таблицы, скрипт, чужой парсер) и приходят готовым массивом.
//
// Зачем он нужен, раз есть ИИ-экстрактор:
//   1. Работает без ключей и без внешних вызовов — на нём тестируется вся
//      цепочка импорта, включая ревью и перенос в банк вопросов.
//   2. Это дефолт: пока EDUCATION_EXTRACTOR не переключён явно, ни один
//      файл не уедет во внешний сервис.

import { ValidationError } from "../../../../common/utils/errors.js";

export function isConfigured() {
  return true;
}

/**
 * @param {object} args
 * @param {object[]} args.payloadItems  уже разобранные вопросы
 */
export async function extract({ payloadItems }) {
  if (!Array.isArray(payloadItems) || payloadItems.length === 0) {
    throw new ValidationError(
      "Manual extractor requires a non-empty 'items' array in the request body",
    );
  }

  return {
    items: payloadItems.map((item) => ({
      stem: item.stem,
      options: item.options ?? [],
      correctKeys: item.correctKeys ?? [],
      explanation: item.explanation ?? "",
      topicCode: item.topicCode ?? null,
      // Ручной ввод — доверие максимальное, проверял человек.
      confidence: item.confidence ?? 1,
      sourcePage: item.sourcePage ?? null,
      notes: item.notes ?? "",
    })),
    // Структуру теста ручной экстрактор не предлагает: оператор сам знает,
    // в какую программу и тему кладёт вопросы.
    suggestedProgram: null,
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

export default { name: "manual", isConfigured, extract };
