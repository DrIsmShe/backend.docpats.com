// __tests__/radiology/integrity.test.js
//
// Сигналы добросовестности. Главное свойство, которое здесь проверяется:
// сигналы НИЧЕГО не решают сами. Они не меняют балл, не блокируют сдачу и
// поднимают «требует внимания» только в связке — одиночный сигнал слишком
// легко объясняется обычным поведением.
//
// Второе важное свойство: отсутствие данных от клиента не считается
// «чисто». Браузер можно научить присылать нули, и трактовать тишину как
// доказательство добросовестности было бы самообманом.

import { describe, it, expect } from "vitest";
import {
  assessIntegrity,
  verbatimOverlap,
  shingles,
  normalizeSignals,
  VERBATIM_THRESHOLD,
  FAST_MIN_SAMPLE,
} from "../../modules/radiology/radiology-attempts/services/integrity.service.js";

const EXPERT =
  "Двусторонние инфильтративные изменения в нижних долях с воздушной " +
  "бронхограммой, картина соответствует бактериальной пневмонии тяжёлого течения";

describe("дословное совпадение", () => {
  it("копия эталонного текста видна", () => {
    expect(verbatimOverlap(EXPERT, EXPERT)).toBe(1);
  });

  it("свой ответ о том же самом дословным не считается", () => {
    const own =
      "В базальных отделах с двух сторон вижу снижение прозрачности, думаю про " +
      "воспаление лёгочной ткани бактериальной природы";
    expect(verbatimOverlap(own, EXPERT)).toBeLessThan(VERBATIM_THRESHOLD);
  });

  it("короткий ответ не даёт цепочек — сравнивать нечего", () => {
    expect(verbatimOverlap("пневмония", EXPERT)).toBe(0);
    expect(shingles("три слова всего").size).toBe(0);
  });

  it("регистр и пунктуация сравнению не мешают", () => {
    expect(verbatimOverlap(EXPERT.toUpperCase() + "!!!", EXPERT)).toBe(1);
  });
});

describe("нормализация сигналов клиента", () => {
  it("мусор и отрицательные значения превращаются в нули", () => {
    const s = normalizeSignals({ pasteEvents: -5, pastedChars: "abc", hiddenMs: 1.7 });
    expect(s.pasteEvents).toBe(0);
    expect(s.pastedChars).toBe(0);
    expect(s.hiddenMs).toBe(2);
  });

  it("пустой объект помечается как «данных нет», а не как «чисто»", () => {
    expect(normalizeSignals({}).reported).toBe(false);
    expect(normalizeSignals({ pasteEvents: 0 }).reported).toBe(true);
  });
});

describe("оценка попытки", () => {
  it("аккуратная попытка без сигналов не требует внимания", () => {
    const r = assessIntegrity({
      signals: { pasteEvents: 0, pastedChars: 0, hiddenMs: 1000, focusLosses: 1 },
      durationMs: 240_000,
      avgDurationMs: 250_000,
      sampleSize: 20,
      answerText: "Своими словами про инфильтрат в нижней доле",
      expertText: EXPERT,
    });
    expect(r.flags).toEqual([]);
    expect(r.needsAttention).toBe(false);
  });

  it("длинная вставка отмечается", () => {
    const r = assessIntegrity({
      signals: { pasteEvents: 1, pastedChars: 900 },
      durationMs: 200_000,
      answerText: "текст",
    });
    expect(r.flags).toContain("paste");
  });

  it("половина попытки вне вкладки отмечается", () => {
    const r = assessIntegrity({
      signals: { hiddenMs: 100_000, focusLosses: 4 },
      durationMs: 200_000,
      answerText: "текст",
    });
    expect(r.flags).toContain("away");
    expect(r.awayShare).toBe(0.5);
  });

  it("подозрительно быстрая сдача — только когда средней длительности есть чему верить", () => {
    const fast = {
      signals: {},
      durationMs: 20_000,
      avgDurationMs: 300_000,
      answerText: "текст",
    };
    // Мало данных по кейсу — молчим, иначе первые же попытки все «быстрые».
    expect(assessIntegrity({ ...fast, sampleSize: 2 }).tooFast).toBe(false);
    expect(assessIntegrity({ ...fast, sampleSize: FAST_MIN_SAMPLE }).tooFast).toBe(true);
  });

  it("связка сигналов поднимает «требует внимания», одиночный — нет", () => {
    const one = assessIntegrity({
      signals: { pastedChars: 900 },
      durationMs: 200_000,
      answerText: "текст",
    });
    expect(one.needsAttention).toBe(false);

    const many = assessIntegrity({
      signals: { pastedChars: 900, hiddenMs: 120_000 },
      durationMs: 200_000,
      avgDurationMs: 300_000,
      sampleSize: 10,
      answerText: EXPERT,
      expertText: EXPERT,
    });
    expect(many.needsAttention).toBe(true);
    expect(many.flags).toContain("verbatim_expert");
  });

  it("в повторной попытке дословность с эталоном не отмечается — врач его уже видел", () => {
    const r = assessIntegrity({
      signals: {},
      durationMs: 200_000,
      answerText: EXPERT,
      expertText: EXPERT,
      firstCountedAttempt: false,
    });
    expect(r.flags).not.toContain("verbatim_expert");
    expect(r.expertOverlap).toBe(0);
  });

  it("совпадение с сохранённым ответом чат-бота отмечается отдельно", () => {
    const bot =
      "Данные лабораторные показатели указывают на железодефицитную анемию " +
      "средней степени тяжести, рекомендуется определение ферритина и насыщения трансферрина";
    const r = assessIntegrity({
      signals: {},
      durationMs: 100_000,
      answerText: bot,
      aiBaselineText: bot,
    });
    expect(r.flags).toContain("verbatim_ai");
    expect(r.aiOverlap).toBe(1);
  });

  it("вызов без аргументов не падает и ничего не выдумывает", () => {
    const r = assessIntegrity();
    expect(r.flags).toEqual([]);
    expect(r.clientReported).toBe(false);
    expect(r.awayShare).toBeNull();
  });
});
