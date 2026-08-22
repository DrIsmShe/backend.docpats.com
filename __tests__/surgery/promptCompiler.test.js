// Компилятор промта: поведение при сбоях.
//
// Само качество перевода тестом не проверить — это работа языковой
// модели. Проверяется другое, и оно важнее: компиляция обязана быть
// УЛУЧШЕНИЕМ, а не условием работы. Врач нажал кнопку, генерация будет
// стоить денег и времени; отвалившийся вспомогательный вызов не должен
// отменять её и не должен подсунуть в модель мусор вместо запроса.
//
// Поэтому на любой сбой возвращается исходный текст врача: он хуже
// скомпилированного, но лучше пустоты.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { compilePrompt } from "../../modules/surgery/promptCompiler.service.js";

const RAW = "убрать горбинку";
const originalFetch = global.fetch;
const originalKey = process.env.OPENAI_API_KEY;

function mockFetch(impl) {
  global.fetch = vi.fn(impl);
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
});

describe("компилятор промта", () => {
  it("возвращает переписанный текст при нормальном ответе", async () => {
    mockFetch(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "smaller nasal tip, photorealistic" } }],
      }),
    }));

    const r = await compilePrompt(RAW, "rhinoplasty");
    expect(r.compiled).toBe(true);
    expect(r.prompt).toBe("smaller nasal tip, photorealistic");
  });

  it("без ключа отдаёт текст врача, а не падает", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await compilePrompt(RAW, "rhinoplasty");
    expect(r.compiled).toBe(false);
    expect(r.prompt).toBe(RAW);
  });

  it("на ошибку HTTP отдаёт текст врача", async () => {
    mockFetch(async () => ({
      ok: false,
      status: 429,
      text: async () => "rate limited",
    }));

    const r = await compilePrompt(RAW, "rhinoplasty");
    expect(r.compiled).toBe(false);
    expect(r.prompt).toBe(RAW);
    expect(r.reason).toContain("429");
  });

  it("на разрыв сети отдаёт текст врача", async () => {
    mockFetch(async () => {
      throw new Error("ECONNRESET");
    });

    const r = await compilePrompt(RAW, "rhinoplasty");
    expect(r.compiled).toBe(false);
    expect(r.prompt).toBe(RAW);
  });

  it("подозрительно короткий ответ отвергает", async () => {
    // "nose" не промт: модель изображений не сделает из него ничего
    // осмысленного, и запрос врача тут заведомо лучше.
    mockFetch(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "nose" } }] }),
    }));

    const r = await compilePrompt(RAW, "rhinoplasty");
    expect(r.compiled).toBe(false);
    expect(r.prompt).toBe(RAW);
  });

  it("пустой запрос не отправляет в модель вовсе", async () => {
    mockFetch(async () => {
      throw new Error("не должно вызываться");
    });

    const r = await compilePrompt("   ", "rhinoplasty");
    expect(r.compiled).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
