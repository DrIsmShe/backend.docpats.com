// Названия разделов витрины на пяти языках.
//
// Модель здесь не зовём — важны правила, а не качество перевода:
//   • машина дописывает ТОЛЬКО пустые языки: администратор, назвавший
//     полку так, как её зовут в клинике, не должен обнаружить на её месте
//     дословный перевод;
//   • ответ, не похожий на язык, отбрасывается. Переводчик рассчитан на
//     статьи и на одном слове возвращает что придётся — так арабская
//     витрина получила русское слово кириллицей. Пустое поле честнее:
//     интерфейс покажет русское название, и человек увидит, что перевода
//     нет, а подделка выглядит переведённой и не будет замечена никогда.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const переводчик = vi.fn();

vi.mock("../../modules/translation/translation.provider.js", () => ({
  translate: (...args) => переводчик(...args),
}));

const { перевестиНазвание } = await import(
  "../../modules/video/services/videoCategory.service.js"
);

/** Правдоподобный ответ переводчика: своя письменность у каждого языка. */
const ОБРАЗЦЫ = {
  en: "Scan reviews",
  az: "Sekil tehlilleri",
  tr: "Goruntu incelemeleri",
  ar: "تحليل الصور",
};

describe("перевод названия раздела", () => {
  beforeEach(() => {
    переводчик.mockReset();
    переводчик.mockImplementation(({ toLanguage }) =>
      Promise.resolve({ content: ОБРАЗЦЫ[toLanguage] }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("дописывает недостающие языки", async () => {
    const итог = await перевестиНазвание({ ru: "Разборы снимков" });

    expect(итог.ru).toBe("Разборы снимков");
    expect(итог.en).toBe(ОБРАЗЦЫ.en);
    expect(итог.az).toBe(ОБРАЗЦЫ.az);
    expect(итог.tr).toBe(ОБРАЗЦЫ.tr);
    expect(итог.ar).toBe(ОБРАЗЦЫ.ar);
  });

  it("не трогает названия, вписанные руками", async () => {
    const итог = await перевестиНазвание({
      ru: "Разборы снимков",
      en: "Film reading club",
    });

    expect(итог.en).toBe("Film reading club");
    // Модель звали только за тремя оставшимися языками.
    expect(переводчик).toHaveBeenCalledTimes(3);
  });

  it("пустая строка считается отсутствующим переводом", async () => {
    const итог = await перевестиНазвание({ ru: "Итоги приёма", tr: "   " });
    expect(итог.tr).toBe(ОБРАЗЦЫ.tr);
  });

  it("сбой одного языка не отменяет остальные", async () => {
    переводчик.mockImplementation(({ toLanguage }) =>
      toLanguage === "ar"
        ? Promise.reject(new Error("модель недоступна"))
        : Promise.resolve({ content: ОБРАЗЦЫ[toLanguage] }),
    );

    const итог = await перевестиНазвание({ ru: "Подготовка" });

    expect(итог.en).toBe(ОБРАЗЦЫ.en);
    // Арабского не вышло — поле осталось пустым, а не сломало остальные.
    expect(итог.ar).toBeUndefined();
  });

  it("кириллица вместо перевода отбрасывается", async () => {
    // Ровно то, что случилось на боевой витрине: раздел «Анатомия» получил
    // арабским текстом русское слово.
    переводчик.mockResolvedValue({ content: "Анатомия" });

    const итог = await перевестиНазвание({ ru: "Анатомия" });

    expect(итог.ar).toBeUndefined();
    expect(итог.en).toBeUndefined();
    expect(итог.tr).toBeUndefined();
    // Русское название на месте — интерфейс покажет его.
    expect(итог.ru).toBe("Анатомия");
  });

  it("арабский ответ на латинице тоже отбрасывается", async () => {
    переводчик.mockImplementation(({ toLanguage }) =>
      Promise.resolve({ content: toLanguage === "ar" ? "Anatomy" : ОБРАЗЦЫ[toLanguage] }),
    );

    const итог = await перевестиНазвание({ ru: "Анатомия" });

    expect(итог.ar).toBeUndefined();
    expect(итог.en).toBe(ОБРАЗЦЫ.en);
  });

  it("длинный перевод обрезается до предела схемы", async () => {
    переводчик.mockResolvedValue({ content: "a".repeat(200) });
    const итог = await перевестиНазвание({ ru: "Раздел" });
    expect(итог.en).toHaveLength(80);
  });

  it("без русского названия модель не зовём", async () => {
    const итог = await перевестиНазвание({ ru: "" });
    expect(переводчик).not.toHaveBeenCalled();
    expect(итог.en).toBeUndefined();
  });
});
