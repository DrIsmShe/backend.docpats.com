// __tests__/labInsight/labFlags.test.js
//
// Арифметика, решающая, что показать пациенту как отклонение.
//
// Почему на неё столько тестов: это единственная часть расшифровки, чей
// вывод пациент проверить НЕ может. Он умеет сравнить 98 со 120–160, но
// не умеет проверить фразу «умеренно тревожно». Поэтому фразы здесь и
// нет — есть расстояние до границы, и оно обязано считаться правильно
// на тех формах записи, которые реально печатают лаборатории.

import { describe, it, expect } from "vitest";
import {
  parseValue,
  parseRange,
  evaluate,
  evaluateAll,
  summarize,
} from "../../modules/labInsight/services/labFlags.service.js";

describe("чтение значения", () => {
  it("понимает запятую как разделитель — так печатает половина бланков", () => {
    expect(parseValue("4,56").value).toBe(4.56);
  });

  it("понимает «менее» и «более»", () => {
    expect(parseValue("<0.5")).toEqual({ value: 0.5, bound: "lt" });
    expect(parseValue(">100")).toEqual({ value: 100, bound: "gt" });
  });

  it("вытаскивает число из мусора вокруг", () => {
    expect(parseValue("  12.3 *").value).toBe(12.3);
  });

  it("не выдумывает число там, где его нет", () => {
    expect(parseValue("не обнаружено").value).toBeNull();
    expect(parseValue("").value).toBeNull();
  });
});

describe("чтение референсного интервала", () => {
  it("диапазон через тире, дефис и многоточие", () => {
    expect(parseRange("120-160")).toEqual({ min: 120, max: 160, text: null });
    expect(parseRange("120 – 160")).toEqual({ min: 120, max: 160, text: null });
    expect(parseRange("3.5...5.1")).toEqual({ min: 3.5, max: 5.1, text: null });
  });

  it("только верхняя граница: «до 5.2», «< 5.2», «менее 5.2»", () => {
    for (const s of ["до 5.2", "< 5.2", "менее 5.2"]) {
      expect(parseRange(s), s).toEqual({ min: null, max: 5.2, text: null });
    }
  });

  it("качественная норма распознаётся, но сравнивать нечего", () => {
    const r = parseRange("отрицательно");
    expect(r.text).toBeTruthy();
    expect(r.min).toBeNull();
    expect(r.max).toBeNull();
  });

  it("непонятную строку не угадывает", () => {
    // Лучше не сказать ничего, чем сравнить с неправильно понятым
    // интервалом: ложное спокойствие хуже отсутствия вывода.
    expect(parseRange("см. примечание")).toBeNull();
    expect(parseRange("")).toBeNull();
  });
});

describe("оценка показателя", () => {
  it("значение внутри интервала — норма", () => {
    const r = evaluate({ rawValue: "140", refText: "120-160" });
    expect(r.level).toBe("normal");
    expect(r.direction).toBeNull();
  });

  it("ниже нормы помечается направлением вниз", () => {
    // 98 при норме 120–160 — это 55 % ширины интервала за краем, то есть
    // «сильно», а не «чуть-чуть». Проверяем факт отклонения и сторону;
    // градация проверяется отдельным тестом ниже.
    const r = evaluate({ rawValue: "98", refText: "120-160" });
    expect(["out", "far"]).toContain(r.level);
    expect(r.direction).toBe("low");
  });

  it("значение чуть ниже края — «out», а не «far»", () => {
    const r = evaluate({ rawValue: "116", refText: "120-160" });
    expect(r.level).toBe("out");
    expect(r.direction).toBe("low");
  });

  it("сильный выход отличается от небольшого", () => {
    // 5.3 при норме до 5.2 и 12.0 при той же норме — для человека это
    // очень разные новости, и экран обязан их различать.
    const slight = evaluate({ rawValue: "5.3", refText: "3.5-5.2" });
    const large = evaluate({ rawValue: "12.0", refText: "3.5-5.2" });

    expect(slight.level).toBe("out");
    expect(large.level).toBe("far");
  });

  it("значение у самого края — «на границе», а не просто норма", () => {
    // Формально норма, но запаса нет: человеку полезно знать.
    const r = evaluate({ rawValue: "120.5", refText: "120-160" });
    expect(r.level).toBe("borderline");
  });

  it("НЕТ РЕФЕРЕНСА — НЕТ ВЫВОДА, а не «норма»", () => {
    // Подставить «обычную» норму значит сравнить результат пациента с
    // чужой лабораторией. У разных методик разные интервалы.
    const r = evaluate({ rawValue: "98", refText: "" });
    expect(r.level).toBe("unknown");
    expect(r.direction).toBeNull();
  });

  it("нечитаемое значение не превращается в норму", () => {
    const r = evaluate({ rawValue: "[?]", refText: "120-160" });
    expect(r.level).toBe("unknown");
  });

  it("«<0.5» при норме «до 5.2» — норма, но без стрелок", () => {
    const r = evaluate({ rawValue: "<0.5", refText: "до 5.2" });
    expect(r.level).toBe("normal");
    expect(r.direction).toBeNull();
  });

  it("«>100» при норме «до 5.2» не считается нормой", () => {
    const r = evaluate({ rawValue: ">100", refText: "до 5.2" });
    // Точное значение неизвестно, вывод делать не на чем — но и
    // спокойным этот случай называть нельзя.
    expect(r.level).not.toBe("normal");
  });

  it("односторонний интервал работает: «до 5.2» и значение 7", () => {
    const r = evaluate({ rawValue: "7", refText: "до 5.2" });
    expect(r.level).toBe("far");
    expect(r.direction).toBe("high");
  });
});

describe("сводка по бланку", () => {
  it("считает отклонения и отдельно то, о чём вывода нет", () => {
    const rows = evaluateAll([
      { name: "Гемоглобин", rawValue: "98", unit: "г/л", refText: "120-160" },
      { name: "Лейкоциты", rawValue: "6.1", unit: "", refText: "4-9" },
      { name: "СРБ", rawValue: "12", unit: "", refText: "" },
    ]);
    const s = summarize(rows);

    expect(s.total).toBe(3);
    expect(s.outOfRange).toBe(1);
    expect(s.normal).toBe(1);
    // «Нет вывода» — это не «всё хорошо», и в сводке они не смешиваются.
    expect(s.unknown).toBe(1);
  });

  it("порядок строк сохраняется — он с бланка", () => {
    const rows = evaluateAll([
      { name: "A", rawValue: "1", refText: "0-2" },
      { name: "B", rawValue: "5", refText: "0-2" },
    ]);
    expect(rows.map((r) => r.name)).toEqual(["A", "B"]);
  });
});
