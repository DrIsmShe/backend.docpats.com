// server/modules/radiology/radiology-attempts/services/diagnosisMatcher.js
//
// Оценка ДИАГНОЗА, введённого учащимся свободным текстом. Общая для трёх
// станций арены: снимки, «Анализы», «Виртуальный пациент».
//
// Зачем отдельный модуль: раньше диагноз сверялся ТОЛЬКО точным совпадением
// строки с принятым ключом. Врач, написавший «Ревматоидный артрит,
// серопозитивный (РФ и анти-ЦЦП положительные), активная стадия (DAS28 > 5,1),
// эрозивная форма» получал 0 — при ключе «ревматоидный артрит». Тренажёр
// наказывал за грамотную развёрнутую формулировку, то есть за ровно то
// поведение, которому должен учить.
//
// Логика в два шага, от дешёвого к терпимому:
//   1. точное совпадение нормализованного ключа — как было (быстро, ясно);
//   2. вхождение принятого ключа ИЛИ синонима в фразу учащегося.
//
// Вхождение проверяется по СЛОВАМ, а не по подстроке: и фраза, и кандидат
// обкладываются пробелами, поэтому ключ «жда» не сработает внутри «жданов», а
// «артрит» — внутри «периартрит». Без этого матчер начал бы ставить зачёт за
// случайные совпадения, что хуже прежнего строгого поведения.
//
// ИИ здесь намеренно не используется: сверка формулировки с готовым списком
// принятых терминов — задача для строки, а не для модели. Свободный текст
// заключения оценивает impressionGrader, это отдельная история.

/**
 * Нормализация под сравнение: регистр, любые разделители и пунктуация в
 * пробел. По краям — по пробелу, чтобы искать вхождение целыми словами.
 */
export function normalizeForMatch(value) {
  const inner = String(value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return inner ? ` ${inner} ` : "";
}

/**
 * Оценка диагноза.
 *
 * @param {object} args
 * @param {string[]} [args.givenKeys]     что прислал клиент в diagnosisKeys
 * @param {string}   [args.givenText]     свободная формулировка учащегося
 * @param {string[]} [args.acceptedKeys]  принятые ключи диагноза из кейса
 * @param {string[]} [args.synonyms]      синонимы диагноза из кейса
 * @returns {{score: 1|0|null, how: "key"|"phrase"|null, matched: string|null}}
 *   score === null — у кейса нет эталона диагноза, оценивать нечего
 *   (компонент исключается из нормировки, как и раньше).
 */
export function gradeDiagnosis({
  givenKeys = [],
  givenText = "",
  acceptedKeys = [],
  synonyms = [],
} = {}) {
  const accepted = (acceptedKeys ?? [])
    .map((k) => String(k ?? "").trim().toLowerCase())
    .filter(Boolean);

  if (accepted.length === 0) {
    return { score: null, how: null, matched: null };
  }

  // 1. Точное совпадение — прежнее поведение.
  const acceptedSet = new Set(accepted);
  for (const key of givenKeys ?? []) {
    const norm = String(key ?? "").trim().toLowerCase();
    if (norm && acceptedSet.has(norm)) {
      return { score: 1, how: "key", matched: norm };
    }
  }

  // 2. Ключ или синоним внутри формулировки учащегося.
  const phrase = normalizeForMatch(givenText);
  if (phrase) {
    // Сначала длинные кандидаты: «ревматоидный артрит» информативнее, чем
    // «артрит», и в разборе полезнее показать именно его.
    const candidates = [...accepted, ...(synonyms ?? []).map((s) => String(s ?? "").trim().toLowerCase())]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);

    for (const candidate of candidates) {
      const needle = normalizeForMatch(candidate);
      if (needle && phrase.includes(needle)) {
        return { score: 1, how: "phrase", matched: candidate };
      }
    }
  }

  return { score: 0, how: null, matched: null };
}
