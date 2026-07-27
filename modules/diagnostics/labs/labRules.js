// server/modules/diagnostics/labs/labRules.js
//
// ДЕТЕРМИНИРОВАННЫЙ разбор лабораторной панели: сравнение с референсами,
// критические значения и связки показателей.
//
// Почему это код, а не запрос к модели: цифры нельзя доверять языковой модели.
// «Гемоглобин 88 при норме 120–150» — это вычитание, и оно должно быть
// воспроизводимым, а не вероятностным. Модель подключается ПОСЛЕ и объясняет
// клинический смысл того, что посчитал код (labs.analyzer.js).
//
// Референсы берутся из самой панели: лаборатории отличаются, и подставлять
// «общепринятые» интервалы вместо тех, что напечатаны на бланке, — прямой путь
// к неверному выводу. Если референса нет, показатель помечается как
// неинтерпретируемый, а не сравнивается с выдуманной нормой.
//
// Пороги критических значений — единственное, что зашито здесь: это не
// «норма», а общепризнанные значения, при которых нужно действовать сейчас.
// Список намеренно короткий и консервативный.

/** Пороги, при которых результат требует немедленных действий. */
export const CRITICAL_THRESHOLDS = {
  hgb: { low: 70, unit: "г/л", why: "тяжёлая анемия" },
  plt: { low: 30, unit: "10⁹/л", why: "риск спонтанного кровотечения" },
  wbc: { low: 1, high: 50, unit: "10⁹/л", why: "агранулоцитоз либо лейкоцитоз" },
  neut: { low: 0.5, unit: "10⁹/л", why: "фебрильная нейтропения" },
  k: { low: 2.5, high: 6.5, unit: "ммоль/л", why: "риск нарушений ритма" },
  na: { low: 120, high: 160, unit: "ммоль/л", why: "риск отёка мозга и судорог" },
  glucose: { low: 2.8, high: 25, unit: "ммоль/л", why: "гипогликемия либо кетоацидоз" },
  creatinine: { high: 400, unit: "мкмоль/л", why: "тяжёлое почечное повреждение" },
  ca: { low: 1.6, high: 3.5, unit: "ммоль/л", why: "риск судорог и аритмий" },
  inr: { high: 5, unit: "", why: "высокий риск кровотечения" },
};

/**
 * Связки: показатели, которые нужно смотреть вместе. Пропущенная связка —
 * типичная ошибка разбора «по строчкам».
 */
export const PAIRED_CHECKS = [
  {
    keys: ["hgb", "ferritin"],
    note: "Снижены гемоглобин и ферритин — картина железодефицита; уточните источник потери железа.",
    when: (v) => v.hgb?.status === "low" && v.ferritin?.status === "low",
  },
  {
    keys: ["hgb", "mcv"],
    note: "Анемия с изменённым MCV — тип анемии определяется именно этим сочетанием.",
    when: (v) => v.hgb?.status === "low" && v.mcv && v.mcv.status !== "normal",
  },
  {
    keys: ["creatinine", "k"],
    note: "Повышены креатинин и калий — сочетание, опасное для сердца при почечной недостаточности.",
    when: (v) => v.creatinine?.status === "high" && v.k?.status === "high",
  },
  {
    keys: ["alt", "ast", "bilirubin"],
    note: "Повышены трансаминазы вместе с билирубином — оцените печёночную функцию, а не отдельные цифры.",
    when: (v) =>
      (v.alt?.status === "high" || v.ast?.status === "high") &&
      v.bilirubin?.status === "high",
  },
  {
    keys: ["crp", "wbc"],
    note: "Повышены СРБ и лейкоциты — воспалительный ответ; ищите очаг.",
    when: (v) => v.crp?.status === "high" && v.wbc?.status === "high",
  },
  {
    keys: ["tsh", "ft4"],
    note: "ТТГ и свободный Т4 интерпретируются только в паре.",
    when: (v) => v.tsh && v.ft4,
  },
];

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value ?? "")
    .replace(",", ".")
    .replace(/[^\d.\-]/g, "");
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Референс вида «3.5-5.1», «3,5 – 5,1», «< 5», «до 5». */
export function parseRefRange(item) {
  if (item?.refLow != null || item?.refHigh != null) {
    return { low: toNumber(item.refLow), high: toNumber(item.refHigh) };
  }
  const text = String(item?.refText ?? item?.refRange ?? "").trim();
  if (!text) return { low: null, high: null };

  const pair = text.match(/(-?[\d.,]+)\s*[–—\-‒]\s*(-?[\d.,]+)/);
  if (pair) return { low: toNumber(pair[1]), high: toNumber(pair[2]) };

  const upper = text.match(/^(?:<|до|менее)\s*(-?[\d.,]+)/i);
  if (upper) return { low: null, high: toNumber(upper[1]) };

  const lower = text.match(/^(?:>|от|более)\s*(-?[\d.,]+)/i);
  if (lower) return { low: toNumber(lower[1]), high: null };

  return { low: null, high: null };
}

/**
 * Разбор одного показателя.
 * status: normal | low | high | unknown (нет числа или нет референса)
 */
export function evaluateItem(item) {
  const value = toNumber(item?.value);
  const { low, high } = parseRefRange(item);
  const key = String(item?.key ?? "").toLowerCase();

  const base = {
    key,
    name: item?.name ?? key,
    value: item?.value,
    numeric: value,
    unit: item?.unit ?? "",
    refLow: low,
    refHigh: high,
  };

  if (value == null) {
    return { ...base, status: "unknown", reason: "значение не число — сравнить нельзя" };
  }
  if (low == null && high == null) {
    return {
      ...base,
      status: "unknown",
      reason: "у показателя нет референсного интервала — норму не подставляем",
    };
  }

  let status = "normal";
  if (low != null && value < low) status = "low";
  if (high != null && value > high) status = "high";

  // Насколько далеко от границы — это и есть «значимость», без гадания.
  let deviation = 0;
  if (status === "low" && low) deviation = (low - value) / Math.abs(low);
  if (status === "high" && high) deviation = (value - high) / Math.abs(high);

  const critical = isCritical(key, value);

  return {
    ...base,
    status,
    deviationShare: Math.round(deviation * 100) / 100,
    // Пограничным считаем отклонение до 10% от границы: обычно это повод
    // перепроверить, а не лечить.
    borderline: status !== "normal" && deviation <= 0.1,
    critical,
  };
}

/** Критическое значение по общепризнанным порогам. */
export function isCritical(key, value) {
  const rule = CRITICAL_THRESHOLDS[String(key).toLowerCase()];
  if (!rule || value == null) return null;
  if (rule.low != null && value < rule.low) {
    return { direction: "low", threshold: rule.low, why: rule.why };
  }
  if (rule.high != null && value > rule.high) {
    return { direction: "high", threshold: rule.high, why: rule.why };
  }
  return null;
}

/**
 * Полный разбор панели.
 * @returns {{items, abnormal, critical, unknown, pairs, summary}}
 */
export function analyzePanel(panel) {
  const items = (Array.isArray(panel) ? panel : []).map(evaluateItem);
  const byKey = Object.fromEntries(items.map((i) => [i.key, i]));

  const abnormal = items.filter((i) => i.status === "low" || i.status === "high");
  const critical = items.filter((i) => i.critical);
  const unknown = items.filter((i) => i.status === "unknown");

  const pairs = PAIRED_CHECKS.filter((check) => {
    try {
      return check.when(byKey);
    } catch {
      return false;
    }
  }).map((check) => ({ keys: check.keys, note: check.note }));

  return {
    items,
    abnormal,
    critical,
    unknown,
    pairs,
    summary: {
      total: items.length,
      abnormal: abnormal.length,
      critical: critical.length,
      // Показатели без референса — это не «норма», и врач должен видеть их числом.
      notInterpretable: unknown.length,
    },
  };
}
