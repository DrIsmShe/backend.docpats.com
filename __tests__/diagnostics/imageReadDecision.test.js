// __tests__/diagnostics/imageReadDecision.test.js
//
// КОГДА СИСТЕМА СМОТРИТ НА САМ СНИМОК.
//
// Решение стоит дорого в обе стороны: не посмотреть на снимок — оставить
// врача без единственного, что из файла можно было получить; посмотреть на
// фото бланка — потратить вызов модели и добавить в дело описание картинки
// вместо напечатанного текста.
//
// Проверяется именно решение, а не чтение: сама модель здесь не участвует.

import { describe, it, expect } from "vitest";
import { shouldReadImage } from "../../modules/diagnostics/ai/imageStudyReader.js";

describe("решение посмотреть на снимок", () => {
  it("врач нажал «Прочитать снимок» — смотрим, что бы ни было в тексте", () => {
    // Тот самый случай, ради которого появилось прямое указание: на плёнке
    // напечатаны маркеры проекции и дата, текст извлёкся, и прежняя догадка
    // принимала КТ за заполненный бланк.
    const filmWithMarkers =
      "A B 2019/07/12 T1 D2 SERIES 4 SIEMENS SOMATOM ACQ 120 kV 250 mAs";
    expect(filmWithMarkers.length).toBeGreaterThan(40);

    expect(
      shouldReadImage({
        mimeType: "image/jpeg",
        forced: true,
        modalitySupportsImages: false,
        extractedText: filmWithMarkers,
      }),
    ).toBe(true);
  });

  it("направление умеет смотреть — смотрим и без указания", () => {
    expect(
      shouldReadImage({
        mimeType: "image/png",
        modalitySupportsImages: true,
        extractedText: "какой-то распознанный текст достаточной длины, более сорока символов",
      }),
    ).toBe(true);
  });

  it("текста в файле почти нет — смотрим: больше взять неоткуда", () => {
    expect(
      shouldReadImage({ mimeType: "image/jpeg", extractedText: "  \n " }),
    ).toBe(true);
  });

  it("фото заполненного бланка идёт прежним путём — на пиксели не смотрим", () => {
    const form =
      "Общий анализ крови. Гемоглобин 138 г/л. Лейкоциты 6,2. СОЭ 8 мм/ч. Тромбоциты 240.";
    expect(
      shouldReadImage({
        mimeType: "image/jpeg",
        modalitySupportsImages: false,
        extractedText: form,
      }),
    ).toBe(false);
  });

  it("PDF не смотрим никогда — даже по прямому указанию", () => {
    // PDF приходит многостраничным документом: путь у него текстовый, и
    // «посмотреть на страницу» здесь не операция.
    expect(
      shouldReadImage({
        mimeType: "application/pdf",
        forced: true,
        modalitySupportsImages: true,
        extractedText: "",
      }),
    ).toBe(false);
  });

  it("отсутствие текста не путается с пустой строкой", () => {
    expect(shouldReadImage({ mimeType: "image/webp" })).toBe(true);
    expect(shouldReadImage({ mimeType: "image/webp", extractedText: null })).toBe(true);
  });
});
