// __tests__/surgery/subjectAnalysis.test.js
//
// Описание человека на снимке — единственное, что говорит модели, КОГО она
// перерисовывает. Пустое место здесь модель заполняет средним по обучающей
// выборке (для пластической хирургии — мужчина 50-65 лет), и именно так
// пациентка на выходе превращалась в пожилого мужчину.
//
// Отсюда требования: отказ модели и любой сбой обязаны давать пустую
// строку, а не текст отказа в промте, и повторный прогон того же снимка не
// должен снова идти в платный API.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  describeSubject,
  subjectAnalysisEnabled,
} from "../../modules/surgery/subjectAnalysis.service.js";

const IMG = Buffer.from("fake-jpeg-bytes");

const answer = (content) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }] }),
  text: async () => "",
});

let originalFetch;
let originalKey;

beforeEach(() => {
  originalFetch = global.fetch;
  originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  delete process.env.SUBJECT_ANALYSIS;
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env.OPENAI_API_KEY = originalKey;
  delete process.env.SUBJECT_ANALYSIS;
  vi.restoreAllMocks();
});

describe("описание субъекта", () => {
  it("возвращает строку описания и шлёт снимок как изображение", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(answer("woman, mid-30s, fair skin, brown hair"));
    global.fetch = fetchMock;

    const out = await describeSubject(IMG, "");
    expect(out).toBe("woman, mid-30s, fair skin, brown hair");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const parts = body.messages.at(-1).content;
    expect(parts.some((p) => p.type === "image_url")).toBe(true);
  });

  it("отказ модели не попадает в промт", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(answer("I'm sorry, I can't help with that."));
    expect(await describeSubject(IMG, "")).toBe("");
  });

  it("ошибка HTTP не срывает генерацию — просто нет описания", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "boom",
    });
    expect(await describeSubject(IMG, "")).toBe("");
  });

  it("сбой сети тоже даёт пустую строку", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    expect(await describeSubject(IMG, "")).toBe("");
  });

  it("повторный прогон того же снимка в API не идёт", async () => {
    const fetchMock = vi.fn().mockResolvedValue(answer("man, 60s, grey hair"));
    global.fetch = fetchMock;

    const first = await describeSubject(IMG, "photo-42.jpg");
    const second = await describeSubject(IMG, "photo-42.jpg");

    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("без ключа не обращается никуда", async () => {
    process.env.OPENAI_API_KEY = "";
    const fetchMock = vi.fn();
    global.fetch = fetchMock;

    expect(subjectAnalysisEnabled()).toBe(false);
    expect(await describeSubject(IMG, "")).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("выключается переменной окружения — снимок никуда не уходит", async () => {
    process.env.SUBJECT_ANALYSIS = "off";
    const fetchMock = vi.fn();
    global.fetch = fetchMock;

    expect(subjectAnalysisEnabled()).toBe(false);
    expect(await describeSubject(IMG, "")).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
