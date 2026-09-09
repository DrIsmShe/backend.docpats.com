// Субтитры: тайминг из сценария и перевод по репликам.
//
// Здесь легко получить незаметную поломку: подпись, съехавшую на кадр.
// Поэтому проверяем не «вернулась строка», а что метки времени идут подряд
// от нуля, что число реплик сходится и что при несовпадении мы отказываемся
// собирать дорожку, а не раскладываем текст наугад.

import { describe, it, expect, vi } from "vitest";

vi.mock("../../modules/translation/translation.provider.js", () => ({
  translate: vi.fn(),
}));

import { translate as translateWithAI } from "../../modules/translation/translation.provider.js";
import { buildVtt, translateScript } from "../../modules/video/render/subtitles.js";

const сценарий = {
  title: "Что показал снимок",
  lang: "ru",
  scenes: [
    { narration: "Первая реплика", seconds: 5 },
    { narration: "Вторая реплика", seconds: 7.5 },
    { narration: "Третья реплика", seconds: 10 },
  ],
};

describe("сборка дорожки", () => {
  it("метки идут подряд и в формате WebVTT", () => {
    const vtt = buildVtt(сценарий.scenes);

    expect(vtt.startsWith("WEBVTT")).toBe(true);
    expect(vtt).toContain("00:00:00.000 --> 00:00:05.000");
    expect(vtt).toContain("00:00:05.000 --> 00:00:12.500");
    expect(vtt).toContain("00:00:12.500 --> 00:00:22.500");
  });

  it("реплики попадают в свои интервалы", () => {
    const vtt = buildVtt(сценарий.scenes);
    const блоки = vtt.split("\n\n").filter((б) => б.includes("-->"));
    expect(блоки[0]).toContain("Первая реплика");
    expect(блоки[2]).toContain("Третья реплика");
  });

  it("пустая реплика не создаёт пустого блока, но время не теряет", () => {
    const scenes = [
      { narration: "", seconds: 5 },
      { narration: "Вторая", seconds: 5 },
    ];
    const vtt = buildVtt(scenes);
    // Первый блок пропущен, второй начинается с пятой секунды — иначе
    // подпись уехала бы на кадр вперёд.
    expect(vtt).toContain("00:00:05.000 --> 00:00:10.000");
    expect(vtt).not.toContain("00:00:00.000 -->");
  });

  it("несовпадение числа переводов — отказ, а не догадка", () => {
    expect(() => buildVtt(сценарий.scenes, ["одна", "две"])).toThrow(/не совпало/i);
  });

  it("пустой сценарий отклоняется", () => {
    expect(() => buildVtt([])).toThrow(/нет сцен/i);
  });
});

describe("перевод сценария", () => {
  it("исходный язык не переводится, остальные — да", async () => {
    translateWithAI.mockImplementation(async ({ content, toLanguage }) =>
      // Подражаем настоящему переводчику: столько же кусков, другой текст.
      ({
        content: content
          .split(/\n-{3,}\n/)
          .map((ч) => `[${toLanguage}] ${ч}`)
          .join("\n---\n"),
      }),
    );

    const дорожки = await translateScript({ script: сценарий });

    expect(дорожки.map((д) => д.lang).sort()).toEqual(["ar", "az", "en", "tr"]);
    expect(дорожки.find((д) => д.lang === "en").vtt).toContain("[en] Первая реплика");
  });

  it("язык, где разделители не пережили перевод, пропускается", async () => {
    // Разложить склеенный текст обратно по репликам нельзя, а ошибка здесь
    // означает подпись не к тому кадру. Лучше без языка, чем вразнобой.
    translateWithAI.mockImplementation(async ({ toLanguage }) => ({
      content: toLanguage === "en" ? "всё одним куском" : "а\n---\nб\n---\nв",
    }));

    const дорожки = await translateScript({ script: сценарий });
    expect(дорожки.map((д) => д.lang)).not.toContain("en");
    expect(дорожки.length).toBe(3);
  });

  it("сбой одного языка не отменяет остальные", async () => {
    translateWithAI.mockImplementation(async ({ toLanguage }) => {
      if (toLanguage === "tr") throw new Error("таймаут");
      return { content: "а\n---\nб\n---\nв" };
    });

    const дорожки = await translateScript({ script: сценарий });
    expect(дорожки.map((д) => д.lang).sort()).toEqual(["ar", "az", "en"]);
  });

  it("можно перевести только на выбранные языки", async () => {
    translateWithAI.mockResolvedValue({ content: "а\n---\nб\n---\nв" });
    const дорожки = await translateScript({ script: сценарий, targets: ["en", "ru"] });
    expect(дорожки.map((д) => д.lang)).toEqual(["en"]);
  });
});
