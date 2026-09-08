// Сборка субтитров из распознанной речи.
//
// Проверяем именно формат: ошибка в тайм-коде не роняет ничего — дорожка
// просто молча не показывается в плеере, и заметит это только зритель.

import { describe, it, expect } from "vitest";
import { vttИзФрагментов } from "../../modules/video/services/videoTranscribe.service.js";

describe("VTT из распознанной речи", () => {
  it("начинается с заголовка WEBVTT", () => {
    const vtt = vttИзФрагментов([{ start: 0, end: 2, text: "Здравствуйте" }]);
    expect(vtt.startsWith("WEBVTT")).toBe(true);
  });

  it("пишет часы, минуты, секунды и миллисекунды", () => {
    const vtt = vttИзФрагментов([{ start: 3661.5, end: 3663.25, text: "тест" }]);
    expect(vtt).toContain("01:01:01.500 --> 01:01:03.250");
  });

  it("нумерует реплики подряд", () => {
    const vtt = vttИзФрагментов([
      { start: 0, end: 1, text: "раз" },
      { start: 1, end: 2, text: "два" },
    ]);
    expect(vtt).toContain("1\n00:00:00.000");
    expect(vtt).toContain("2\n00:00:01.000");
  });

  it("длинную реплику переносит по словам, не разрывая их", () => {
    const длинная =
      "Перед исследованием не ешьте четыре часа и возьмите с собой направление";
    const vtt = vttИзФрагментов([{ start: 0, end: 5, text: длинная }]);

    const строки = vtt
      .split("\n\n")[1]
      .split("\n")
      .slice(2);
    expect(строки.length).toBeGreaterThan(1);
    for (const с of строки) expect(с.length).toBeLessThanOrEqual(42);
    // Слова целы: склеенный обратно текст совпадает с исходным началом.
    expect(длинная.startsWith(строки.join(" ").trim())).toBe(true);
  });

  it("выбрасывает пустые фрагменты и нулевую длительность", () => {
    const vtt = vttИзФрагментов([
      { start: 0, end: 1, text: "есть" },
      { start: 1, end: 1, text: "нулевой" },
      { start: 2, end: 3, text: "" },
    ]);
    expect(vtt).toContain("есть");
    expect(vtt).not.toContain("нулевой");
    // Осталась ровно одна реплика.
    expect(vtt.trim().split("\n\n")).toHaveLength(2);
  });

  it("пустой список даёт валидный, но пустой файл", () => {
    const vtt = vttИзФрагментов([]);
    expect(vtt.startsWith("WEBVTT")).toBe(true);
  });
});
