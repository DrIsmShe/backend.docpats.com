// server/modules/labInsight/services/labFlags.service.js
// ─────────────────────────────────────────────────────────────────────
//   Что считать отклонением и насколько оно тревожно — АРИФМЕТИКА.
//
//   Здесь нет модели и не будет. Причина не в осторожности, а в том,
//   что именно этот вывод пациент проверить не может.
//
//   Он видит «гемоглобин 98, норма 120–160» и понимает, откуда взялось
//   «ниже нормы»: он умеет сравнивать числа. А вот суждение
//   «это умеренно тревожно», сгенерированное моделью, выглядит ровно так
//   же убедительно и когда оно ошибочно — и проверить его пациент не в
//   состоянии, он для того и пришёл. Арифметика не ошибается уверенно.
//
//   ГРАДАЦИЯ ОТ ГРАНИЦЫ, А НЕ ОТ ДИАГНОЗА. Мы не знаем, опасен ли
//   конкретный сдвиг у конкретного человека — это и есть работа врача.
//   Мы знаем только, НАСКОЛЬКО значение вышло за границу, и говорим
//   ровно это. «Сильно за пределами» — не «у вас анемия».
//
//   ЕСЛИ РЕФЕРЕНСА НЕТ — НЕТ И ВЫВОДА. Подставить «обычную» норму
//   означало бы сравнить результат пациента с чужой лабораторией: у
//   разных методик разные интервалы, и подмена даёт ложную тревогу или,
//   что хуже, ложное спокойствие. Такой показатель помечается «норма на
//   бланке не указана» и не окрашивается.
// ─────────────────────────────────────────────────────────────────────

/** Уровни, в порядке возрастания серьёзности. */
export const LEVELS = ["unknown", "normal", "borderline", "out", "far"];

/**
 * Насколько далеко за границей считается «сильно».
 *
 * Порог в 20 % ширины интервала выбран как заведомо консервативный: он
 * НЕ клинический критерий, а признак «это уже не округление». Любой
 * выход за границу и так помечается; порог отделяет «чуть-чуть» от
 * «заметно», чтобы пациент видел разницу между 5.3 при норме до 5.2 и
 * 12.0 при той же норме.
 */
const FAR_RATIO = 0.2;

// Значение у самого края интервала (в пределах 5 % ширины изнутри) —
// «на границе». Формально норма, но человеку полезно знать, что запаса
// нет: следующая сдача может уйти за край.
const BORDERLINE_RATIO = 0.05;

/**
 * Число из строки с бланка.
 *
 * Понимает запятую как разделитель («4,5»), знаки «<» и «>» и мусор
 * вокруг числа. Возвращает { value, bound } — bound это «менее»/«более»,
 * когда лаборатория написала «<0.5»: такое значение сравнивать с
 * серединой интервала нельзя, и это учитывается ниже.
 */
export function parseValue(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return { value: null, bound: null };

  let bound = null;
  if (s.startsWith("<")) bound = "lt";
  else if (s.startsWith(">")) bound = "gt";

  const m = s.replace(",", ".").match(/-?\d+(\.\d+)?/);
  if (!m) return { value: null, bound };

  const value = Number(m[0]);
  return { value: Number.isFinite(value) ? value : null, bound };
}

/**
 * Референсный интервал из строки с бланка.
 *
 * Формы, которые встречаются на настоящих бланках:
 *   «120-160», «120 – 160», «120...160»   → min/max
 *   «до 5.2», «< 5.2», «менее 5.2»        → только max
 *   «от 3.5», «> 3.5», «более 3.5»        → только min
 *   «отрицательно», «не обнаружено»       → качественная норма
 *
 * Всё остальное — null: лучше не сказать ничего, чем сравнить с
 * неправильно понятым интервалом.
 */
export function parseRange(raw) {
  const s = String(raw ?? "").trim().toLowerCase().replace(/,/g, ".");
  if (!s) return null;

  // Диапазон: два числа, разделённые чем угодно похожим на тире.
  const pair = s.match(/(-?\d+(?:\.\d+)?)\s*(?:[-–—]|\.\.\.|до)\s*(-?\d+(?:\.\d+)?)/);
  if (pair) {
    const min = Number(pair[1]);
    const max = Number(pair[2]);
    if (Number.isFinite(min) && Number.isFinite(max) && min <= max) {
      return { min, max, text: null };
    }
  }

  const upper = s.match(/(?:^|\s)(?:до|менее|ниже|<|<=|≤)\s*(-?\d+(?:\.\d+)?)/);
  if (upper) {
    const max = Number(upper[1]);
    if (Number.isFinite(max)) return { min: null, max, text: null };
  }

  const lower = s.match(/(?:^|\s)(?:от|более|выше|>|>=|≥)\s*(-?\d+(?:\.\d+)?)/);
  if (lower) {
    const min = Number(lower[1]);
    if (Number.isFinite(min)) return { min: null, max: null, text: null, minOnly: min };
  }

  // Качественная норма: сравнивать нечего, но сказать про неё можно.
  if (/отриц|не обнаруж|negative|not detected/.test(s)) {
    return { min: null, max: null, text: s };
  }

  return null;
}

/**
 * Оценка одного показателя.
 *
 * @returns {{level, direction, ratio, range, value}} — level из LEVELS,
 *   direction "high" | "low" | null.
 */
export function evaluate({ rawValue, refText }) {
  const { value, bound } = parseValue(rawValue);
  const parsed = parseRange(refText);

  // Нормализуем форму «только нижняя граница».
  const range = parsed?.minOnly !== undefined
    ? { min: parsed.minOnly, max: null, text: null }
    : parsed;

  if (value === null || !range || (range.min === null && range.max === null)) {
    return { level: "unknown", direction: null, ratio: null, range, value };
  }

  // «<0.5» при норме «до 5.2» — значение заведомо в пределах, но точное
  // число неизвестно. Считать его равным 0.5 и рисовать стрелки нельзя.
  if (bound) {
    const withinByBound =
      (bound === "lt" && range.max !== null && value <= range.max) ||
      (bound === "gt" && range.min !== null && value >= range.min);
    if (withinByBound) {
      return { level: "normal", direction: null, ratio: null, range, value };
    }
    return { level: "unknown", direction: null, ratio: null, range, value };
  }

  const below = range.min !== null && value < range.min;
  const above = range.max !== null && value > range.max;

  if (!below && !above) {
    // Ширина интервала нужна, чтобы понять «близко к краю». Если
    // задана одна граница, ширины нет — и вывода о близости тоже.
    const width =
      range.min !== null && range.max !== null ? range.max - range.min : null;
    if (width && width > 0) {
      const margin = width * BORDERLINE_RATIO;
      const nearLow = range.min !== null && value - range.min <= margin;
      const nearHigh = range.max !== null && range.max - value <= margin;
      if (nearLow || nearHigh) {
        return {
          level: "borderline",
          direction: nearLow ? "low" : "high",
          ratio: 0,
          range,
          value,
        };
      }
    }
    return { level: "normal", direction: null, ratio: null, range, value };
  }

  const direction = below ? "low" : "high";
  const border = below ? range.min : range.max;
  const width =
    range.min !== null && range.max !== null ? range.max - range.min : null;

  // Насколько вышли за край, в долях ширины интервала. Когда ширины нет
  // (задана одна граница), берём долю от самой границы — грубее, но
  // сравнимо по порядку.
  const distance = Math.abs(value - border);
  const scale = width && width > 0 ? width : Math.abs(border) || 1;
  const ratio = distance / scale;

  return {
    level: ratio >= FAR_RATIO ? "far" : "out",
    direction,
    ratio: Math.round(ratio * 100) / 100,
    range,
    value,
  };
}

/** Оценить весь бланк. Порядок не меняем: он с бланка. */
export function evaluateAll(parameters = []) {
  return parameters.map((p) => ({
    name: String(p.name || "").trim(),
    rawValue: String(p.rawValue ?? "").trim(),
    unit: String(p.unit || "").trim(),
    refText: String(p.refText || "").trim(),
    ...evaluate({ rawValue: p.rawValue, refText: p.refText }),
  }));
}

/** Сводка по бланку: сколько отклонений и есть ли сильные. */
export function summarize(evaluated = []) {
  const out = evaluated.filter((e) => e.level === "out" || e.level === "far");
  return {
    total: evaluated.length,
    normal: evaluated.filter((e) => e.level === "normal").length,
    borderline: evaluated.filter((e) => e.level === "borderline").length,
    outOfRange: out.length,
    far: evaluated.filter((e) => e.level === "far").length,
    // Показатели, по которым вывода нет: нечитаемое значение или
    // отсутствующий на бланке референс. Их обязательно показывать —
    // «нет вывода» это не «всё хорошо».
    unknown: evaluated.filter((e) => e.level === "unknown").length,
  };
}

export default { evaluate, evaluateAll, summarize, parseValue, parseRange, LEVELS };
