// server/modules/radiology/radiology-attempts/services/variantPicker.js
//
// ЧИСЛОВЫЕ ВАРИАНТЫ КЕЙСА: выбор варианта для попытки и наложение его данных
// на кейс.
//
// Зачем варианты. Ответ на конкретный кейс легко передать словами: «там
// значимы гемоглобин и ферритин, диагноз ЖДА». Одного скриншота в общем чате
// достаточно, чтобы кейс перестал что-либо измерять. Если у соседа другие
// цифры — пересказ не помогает, а повторный зачёт перестаёт быть тем же
// текстом слово в слово.
//
// Выбор ДЕТЕРМИНИРОВАННЫЙ, по номеру попытки, а не случайный. Три причины:
// результат воспроизводим (пересчитать оценку можно спустя месяц), варианты
// достаются по кругу — врач увидит их все, и одинаковым попыткам не выпадет
// один и тот же вариант дважды подряд.
//
// Индекс 0 — базовый кейс (то, что заполнил автор), 1..N — варианты. Так
// кейсы без вариантов работают ровно как раньше: индекс всегда 0.
//
// Вариант меняет ТОЛЬКО значения. Ни диагноз, ни список нужных обследований,
// ни логика разбора от него не зависят — иначе это был бы другой кейс, и
// статистику по нему нельзя было бы складывать.

/**
 * Какой вариант достаётся этой попытке.
 * @param {number} attemptNo   номер попытки врача по кейсу (с 1)
 * @param {number} variantCount сколько вариантов у кейса
 * @returns {number} 0 — базовый кейс, 1..variantCount — вариант
 */
export function pickVariantIndex(attemptNo, variantCount) {
  const count = Number(variantCount) || 0;
  if (count <= 0) return 0;
  const n = Number(attemptNo) || 1;
  // (n - 1) % (count + 1): первая попытка — базовый кейс, дальше по кругу.
  return Math.max(0, (n - 1) % (count + 1));
}

/** Подпись варианта для интерфейса и разбора. */
export function variantLabelOf(caseDoc, index) {
  if (!index) return "";
  const v = caseDoc?.variants?.[index - 1];
  return v?.label || `Вариант ${index}`;
}

/**
 * Панель и значимые отклонения станции «Анализы» с учётом варианта.
 * Значения варианта накладываются на панель автора ПО КЛЮЧУ: показатель,
 * которого в варианте нет, остаётся из базового кейса. Так вариант может
 * менять две цифры из десяти, а не переписывать панель целиком.
 */
export function applyLabVariant(caseDoc, index) {
  const basePanel = caseDoc.panel ?? [];
  if (!index) {
    return {
      panel: basePanel,
      significantAbnormal: caseDoc.significantAbnormal ?? [],
      variantLabel: "",
    };
  }

  const variant = caseDoc.variants?.[index - 1];
  if (!variant) {
    return {
      panel: basePanel,
      significantAbnormal: caseDoc.significantAbnormal ?? [],
      variantLabel: "",
    };
  }

  const overrideByKey = new Map((variant.panel ?? []).map((p) => [p.key, p]));
  const panel = basePanel.map((p) => {
    const o = overrideByKey.get(p.key);
    if (!o) return p;
    return {
      key: p.key,
      name: p.name,
      value: o.value ?? p.value,
      unit: o.unit || p.unit,
      refRange: o.refRange || p.refRange,
    };
  });

  const panelKeys = new Set(basePanel.map((p) => p.key));
  // Значимые отклонения варианта фильтруем по ключам панели: ключ, которого в
  // панели нет, сделал бы находку недостижимой — врач не смог бы её отметить.
  const significantAbnormal = (variant.significantAbnormal ?? []).filter((k) =>
    panelKeys.has(k),
  );

  return {
    panel,
    significantAbnormal: significantAbnormal.length
      ? significantAbnormal
      : caseDoc.significantAbnormal ?? [],
    variantLabel: variantLabelOf(caseDoc, index),
  };
}

/**
 * Жалоба и результаты обследований «Виртуального пациента» с учётом варианта.
 * Список обследований и пометки necessary не меняются — только тексты
 * результатов и вводная.
 */
export function applyVpVariant(caseDoc, index) {
  const baseInv = caseDoc.investigations ?? [];
  if (!index) {
    return {
      presentation: caseDoc.presentation ?? "",
      investigations: baseInv,
      variantLabel: "",
    };
  }

  const variant = caseDoc.variants?.[index - 1];
  if (!variant) {
    return {
      presentation: caseDoc.presentation ?? "",
      investigations: baseInv,
      variantLabel: "",
    };
  }

  const overrideByKey = new Map((variant.results ?? []).map((r) => [r.key, r.resultText]));
  const investigations = baseInv.map((inv) => {
    const text = overrideByKey.get(inv.key);
    return text ? { ...(inv.toObject?.() ?? inv), resultText: text } : inv;
  });

  return {
    presentation: variant.presentation || caseDoc.presentation || "",
    investigations,
    variantLabel: variantLabelOf(caseDoc, index),
  };
}
