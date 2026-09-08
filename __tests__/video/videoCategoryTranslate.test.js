// Названия разделов витрины на пяти языках.
//
// Модель здесь не зовём — важно правило, а не качество перевода: машинный
// перевод дописывает ТОЛЬКО пустые языки. Если бы он перезаписывал всё,
// администратор, назвавший полку так, как её зовут в клинике, обнаружил бы
// на её месте дословный перевод — и без всякого следа о том, куда делось
// его название.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const переводчик = vi.fn();

vi.mock("../../modules/translation/translateWithAI.js", () => ({
  translateWithAI: (...args) => переводчик(...args),
}));

const { перевестиНазвание } = await import(
  "../../modules/video/services/videoCategory.service.js"
);

describe("перевод названия раздела", () => {
  beforeEach(() => {
    переводчик.mockReset();
    переводчик.mockImplementation(({ content, toLanguage }) =>
      Promise.resolve({ content: `${content}[${toLanguage}]` }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("дописывает недостающие языки", async () => {
    const итог = await перевестиНазвание({ ru: "Разборы снимков" });

    expect(итог.ru).toBe("Разборы снимков");
    expect(итог.en).toBe("Разборы снимков[en]");
    expect(итог.az).toBe("Разборы снимков[az]");
    expect(итог.tr).toBe("Разборы снимков[tr]");
    expect(итог.ar).toBe("Разборы снимков[ar]");
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
    expect(итог.tr).toBe("Итоги приёма[tr]");
  });

  it("сбой одного языка не отменяет остальные", async () => {
    переводчик.mockImplementation(({ content, toLanguage }) =>
      toLanguage === "ar"
        ? Promise.reject(new Error("модель недоступна"))
        : Promise.resolve({ content: `${content}[${toLanguage}]` }),
    );

    const итог = await перевестиНазвание({ ru: "Подготовка" });

    expect(итог.en).toBe("Подготовка[en]");
    // Арабского не вышло — поле осталось пустым, а не сломало остальные.
    expect(итог.ar).toBeUndefined();
  });

  it("длинный перевод обрезается до предела схемы", async () => {
    переводчик.mockResolvedValue({ content: "я".repeat(200) });
    const итог = await перевестиНазвание({ ru: "Раздел" });
    expect(итог.en).toHaveLength(80);
  });

  it("без русского названия модель не зовём", async () => {
    const итог = await перевестиНазвание({ ru: "" });
    expect(переводчик).not.toHaveBeenCalled();
    expect(итог.en).toBeUndefined();
  });
});
