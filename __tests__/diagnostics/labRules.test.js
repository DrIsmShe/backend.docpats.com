// __tests__/diagnostics/labRules.test.js
//
// Детерминированный разбор лабораторной панели.
//
// Это единственная часть модуля, где цифры считает код, а не модель, — и
// именно поэтому она проверяется первой. Языковая модель может ошибиться в
// вычитании и сделать это уверенно; здесь ошибка невозможна по построению,
// если правила верны.
//
// Главное свойство, которое здесь закреплено: НЕТ РЕФЕРЕНСА — НЕТ ВЫВОДА.
// Подставлять «общепринятую норму» вместо той, что напечатана на бланке
// конкретной лаборатории, — прямой путь к неверной интерпретации.

import { describe, it, expect } from "vitest";
import {
  analyzePanel,
  evaluateItem,
  isCritical,
  parseRefRange,
} from "../../modules/diagnostics/labs/labRules.js";

describe("разбор референсного интервала", () => {
  it("понимает диапазон в разных написаниях", () => {
    expect(parseRefRange({ refText: "120-150" })).toEqual({ low: 120, high: 150 });
    expect(parseRefRange({ refText: "3,5 – 5,1" })).toEqual({ low: 3.5, high: 5.1 });
    expect(parseRefRange({ refText: "0.4—4.0" })).toEqual({ low: 0.4, high: 4 });
  });

  it("понимает односторонние границы", () => {
    expect(parseRefRange({ refText: "< 5" })).toEqual({ low: null, high: 5 });
    expect(parseRefRange({ refText: "до 0,5" })).toEqual({ low: null, high: 0.5 });
    expect(parseRefRange({ refText: "> 60" })).toEqual({ low: 60, high: null });
  });

  it("явные refLow/refHigh важнее текста", () => {
    expect(parseRefRange({ refLow: 1, refHigh: 2, refText: "10-20" })).toEqual({
      low: 1,
      high: 2,
    });
  });

  it("непонятный текст не превращается в выдуманную норму", () => {
    expect(parseRefRange({ refText: "в пределах нормы" })).toEqual({ low: null, high: null });
    expect(parseRefRange({})).toEqual({ low: null, high: null });
  });
});

describe("оценка показателя", () => {
  it("ниже нормы", () => {
    const r = evaluateItem({ key: "hgb", name: "Гемоглобин", value: "88", refText: "120-150" });
    expect(r.status).toBe("low");
    expect(r.borderline).toBe(false);
  });

  it("пограничное отклонение помечается отдельно", () => {
    // 118 при нижней границе 120 — это 1.7% ниже: повод перепроверить, а не лечить.
    const r = evaluateItem({ key: "hgb", value: "118", refText: "120-150" });
    expect(r.status).toBe("low");
    expect(r.borderline).toBe(true);
  });

  it("без референса показатель НЕ сравнивается с выдуманной нормой", () => {
    const r = evaluateItem({ key: "xyz", name: "Некий маркер", value: "42" });
    expect(r.status).toBe("unknown");
    expect(r.reason).toMatch(/референс/i);
  });

  it("нечисловое значение не ломает разбор", () => {
    const r = evaluateItem({ key: "hbsag", name: "HBsAg", value: "отрицательный", refText: "0-1" });
    expect(r.status).toBe("unknown");
  });

  it("запятая как разделитель понимается", () => {
    expect(evaluateItem({ key: "k", value: "5,4", refText: "3,5-5,1" }).status).toBe("high");
  });
});

describe("критические значения", () => {
  it("считаются по порогу, а не по референсу лаборатории", () => {
    // 65 г/л ниже критического порога 70 — вне зависимости от того, какой
    // референс напечатала лаборатория.
    expect(isCritical("hgb", 65)).toMatchObject({ direction: "low", threshold: 70 });
    expect(isCritical("hgb", 95)).toBeNull();
  });

  it("двусторонние пороги работают в обе стороны", () => {
    expect(isCritical("k", 2.1)?.direction).toBe("low");
    expect(isCritical("k", 7)?.direction).toBe("high");
    expect(isCritical("k", 4)).toBeNull();
  });

  it("неизвестный показатель критическим не объявляется", () => {
    expect(isCritical("unknown_marker", 999)).toBeNull();
  });
});

describe("разбор панели целиком", () => {
  const panel = [
    { key: "hgb", name: "Гемоглобин", value: "62", unit: "г/л", refText: "120-150" },
    { key: "ferritin", name: "Ферритин", value: "4", unit: "мкг/л", refText: "15-150" },
    { key: "plt", name: "Тромбоциты", value: "290", unit: "10⁹/л", refText: "150-400" },
    { key: "mcv", name: "MCV", value: "70", unit: "фл", refText: "80-100" },
    { key: "hbsag", name: "HBsAg", value: "отрицательный" },
  ];

  it("раскладывает показатели по состояниям", () => {
    const r = analyzePanel(panel);
    expect(r.summary.total).toBe(5);
    expect(r.abnormal.map((i) => i.key).sort()).toEqual(["ferritin", "hgb", "mcv"]);
    expect(r.summary.notInterpretable).toBe(1); // HBsAg без референса
  });

  it("находит критическое значение", () => {
    const r = analyzePanel(panel);
    expect(r.critical.map((i) => i.key)).toEqual(["hgb"]);
    expect(r.critical[0].critical.why).toMatch(/анеми/i);
  });

  it("подсказывает связки показателей, а не только отдельные строки", () => {
    const r = analyzePanel(panel);
    const notes = r.pairs.map((p) => p.keys.join("+"));
    expect(notes).toContain("hgb+ferritin");
    expect(notes).toContain("hgb+mcv");
  });

  it("пустая панель не ломает разбор", () => {
    const r = analyzePanel([]);
    expect(r.summary).toMatchObject({ total: 0, abnormal: 0, critical: 0 });
    expect(r.pairs).toEqual([]);
  });

  it("мусор вместо панели не ломает разбор", () => {
    expect(analyzePanel(null).items).toEqual([]);
    expect(analyzePanel("нет").summary.total).toBe(0);
  });
});
