// __tests__/radiology/diagnosisMatcher.test.js
//
// Оценка диагноза, введённого свободным текстом (ai-независимая логика).
//
// Первый тест — тот самый случай с прода: врач написал развёрнутую
// формулировку («Ревматоидный артрит, серопозитивный (…), активная стадия
// (DAS28 > 5,1), эрозивная форма…»), в кейсе ключ «ревматоидный артрит».
// Раньше это давало 0 за диагноз, потому что сравнивалась строка целиком.
//
// Второй важный блок — границы слов. Матчер по подстроке поставил бы зачёт за
// «жданов» при ключе «жда» и за «периартрит» при ключе «артрит». Это было бы
// хуже прежнего строгого поведения: тренажёр начал бы засчитывать неверные
// ответы, а такую ошибку никто не заметит.

import { describe, it, expect } from "vitest";
import {
  gradeDiagnosis,
  normalizeForMatch,
} from "../../modules/radiology/radiology-attempts/services/diagnosisMatcher.js";

const REAL_ANSWER =
  "Ревматоидный артрит, серопозитивный (ревматоидный фактор и анти-ЦЦП " +
  "положительные), активная стадия (DAS28 > 5,1), эрозивная форма, " +
  "II рентгенологическая стадия, функциональный класс II";

describe("развёрнутая формулировка врача", () => {
  it("засчитывается, если содержит принятый ключ", () => {
    const res = gradeDiagnosis({
      givenKeys: [REAL_ANSWER.toLowerCase()],
      givenText: REAL_ANSWER,
      acceptedKeys: ["ревматоидный артрит", "ра"],
      synonyms: [],
    });

    expect(res.score).toBe(1);
    expect(res.how).toBe("phrase");
    expect(res.matched).toBe("ревматоидный артрит");
  });

  it("длина ответа значения не имеет — он больше не режется лимитом", () => {
    expect(REAL_ANSWER.length).toBeGreaterThan(120); // ровно тот кейс с прода
    const res = gradeDiagnosis({
      givenText: REAL_ANSWER,
      acceptedKeys: ["ревматоидный артрит"],
    });
    expect(res.score).toBe(1);
  });

  it("засчитывается по синониму", () => {
    const res = gradeDiagnosis({
      givenText: "Полагаю, это болезнь Хашимото с гипотиреозом",
      acceptedKeys: ["аутоиммунный тиреоидит"],
      synonyms: ["болезнь хашимото", "тиреоидит хашимото"],
    });

    expect(res.score).toBe(1);
    expect(res.matched).toBe("болезнь хашимото");
  });

  it("из нескольких подходящих ключей показывает самый информативный", () => {
    const res = gradeDiagnosis({
      givenText: REAL_ANSWER,
      acceptedKeys: ["артрит", "ревматоидный артрит"],
    });
    // Не «артрит»: в разборе полезнее видеть полный термин.
    expect(res.matched).toBe("ревматоидный артрит");
  });

  it("не зависит от регистра и пунктуации", () => {
    const res = gradeDiagnosis({
      givenText: "ЖДА?? — железодефицитная,  анемия!!",
      acceptedKeys: ["железодефицитная анемия"],
    });
    expect(res.score).toBe(1);
  });
});

describe("границы слов: чужое слово не должно засчитываться", () => {
  it("ключ «жда» не срабатывает внутри «жданов»", () => {
    const res = gradeDiagnosis({
      givenText: "Пациент направлен доктором Ждановым, диагноз неясен",
      acceptedKeys: ["жда"],
    });
    expect(res.score).toBe(0);
  });

  it("ключ «артрит» не срабатывает внутри «периартрит»", () => {
    const res = gradeDiagnosis({
      givenText: "Плечелопаточный периартрит",
      acceptedKeys: ["артрит"],
    });
    expect(res.score).toBe(0);
  });

  it("но отдельным словом «артрит» — срабатывает", () => {
    const res = gradeDiagnosis({
      givenText: "Реактивный артрит правого коленного сустава",
      acceptedKeys: ["артрит"],
    });
    expect(res.score).toBe(1);
  });
});

describe("прежнее поведение сохранено", () => {
  it("точное совпадение ключа даёт how=key, без разбора фразы", () => {
    const res = gradeDiagnosis({
      givenKeys: ["Пневмоторакс"],
      acceptedKeys: ["пневмоторакс"],
    });

    expect(res.score).toBe(1);
    expect(res.how).toBe("key");
    expect(res.matched).toBe("пневмоторакс");
  });

  it("кейс без эталона диагноза → null (компонент вне нормировки)", () => {
    const res = gradeDiagnosis({
      givenKeys: ["что угодно"],
      givenText: "что угодно",
      acceptedKeys: [],
    });
    expect(res.score).toBeNull();
  });

  it("неверный ответ по-прежнему 0", () => {
    const res = gradeDiagnosis({
      givenKeys: ["пневмония"],
      givenText: "Внебольничная пневмония нижней доли справа",
      acceptedKeys: ["пневмоторакс"],
      synonyms: ["коллапс лёгкого"],
    });
    expect(res.score).toBe(0);
    expect(res.matched).toBeNull();
  });

  it("пустой ответ — 0, а не случайное совпадение", () => {
    const res = gradeDiagnosis({ acceptedKeys: ["пневмоторакс"] });
    expect(res.score).toBe(0);
  });

  it("вызов без аргументов не падает", () => {
    expect(gradeDiagnosis().score).toBeNull();
  });
});

describe("нормализация", () => {
  it("обкладывает пробелами и сжимает разделители", () => {
    expect(normalizeForMatch("Анти-ЦЦП, положительные!")).toBe(
      " анти ццп положительные ",
    );
  });

  it("пустое значение остаётся пустым (не превращается в пробел)", () => {
    expect(normalizeForMatch("   ")).toBe("");
    expect(normalizeForMatch(null)).toBe("");
  });
});
