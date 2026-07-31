// __tests__/guide/guide.test.js
//
// Агент-гид по продукту.
//
// Проверяется не качество ответов — оно от модели, — а свойства, которые
// делают публичный эндпоинт к модели безопасным и предсказуемым:
//
//   у агента нет инструментов (значит, он не может достать чужие данные,
//     даже если его об этом попросят);
//   корпус уезжает в кэшируемой части промпта (иначе каждый вопрос
//     оплачивается по полной);
//   разговор ограничен по длине и числу ходов;
//   без корпуса агент не отвечает «из головы».

import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

const captured = { params: null };

vi.mock("../../modules/education/education-ingest/extractors/claude.extractor.js", () => ({
  isConfigured: () => true,
  describeApiError: (err) => ({ message: String(err?.message ?? err), retryable: false }),
  getClient: () => ({
    messages: {
      create: async (params) => {
        captured.params = params;
        return {
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Ответ по разделу /docs/for-doctors." }],
          usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
        };
      },
    },
  }),
}));

const CORPUS = {
  text: "<<<РАЗДЕЛ for-doctors>>>\nАдрес на сайте: /docs/for-doctors\n\nПробный период — 6 месяцев.\n<<<КОНЕЦ РАЗДЕЛА for-doctors>>>",
  sections: [{ name: "for-doctors", title: "DocPats для врача", lang: "ru" }],
  at: Date.now(),
};

const corpusMock = vi.fn(async () => CORPUS);
vi.mock("../../modules/guide/corpus.js", () => ({
  getCorpus: (...args) => corpusMock(...args),
  resetCorpusCache: () => {},
  CORPUS_BASE_URL: "https://example.test",
}));

const { askGuide, normalizeMessages, MAX_QUESTION_CHARS, MAX_TURNS } = await import(
  "../../modules/guide/guide.service.js"
);
const { guestGuideRouter } = await import("../../modules/guide/guide.routes.js");

function appWithGuest() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/public", guestGuideRouter);
  // Ошибки сервиса — обычные типизированные ошибки проекта.
  app.use((err, req, res, _next) => {
    res.status(err.status ?? 500).json({ error: err.message });
  });
  return app;
}

beforeEach(() => {
  captured.params = null;
  corpusMock.mockClear();
  corpusMock.mockImplementation(async () => CORPUS);
});

describe("устройство запроса к модели", () => {
  it("у агента нет ни одного инструмента — доступ к данным невозможен по конструкции", async () => {
    await askGuide({ messages: [{ role: "user", content: "Что такое DocPats?" }] });

    expect(captured.params.tools).toBeUndefined();
    expect(captured.params.mcp_servers).toBeUndefined();
  });

  it("корпус лежит в кэшируемой части промпта, а изменчивое — после неё", async () => {
    await askGuide({
      messages: [{ role: "user", content: "Сколько длится пробный период?" }],
      role: "doctor",
      lang: "tr",
    });

    const system = captured.params.system;
    // Инструкция первой и без кэш-метки: она одинакова у всех, кэш начинается
    // с неё и продолжается корпусом.
    expect(system[0].cache_control).toBeUndefined();
    expect(system[1].text).toContain("for-doctors");
    expect(system[1].cache_control).toEqual({ type: "ephemeral" });
    // Роль и язык меняются от пользователя к пользователю — они ПОСЛЕ метки,
    // иначе кэш не совпадал бы ни у кого.
    expect(system[2].text).toContain("physician");
    expect(system[2].text).toContain("Turkish");
  });

  it("правила «только по корпусу» и «не медицинский консультант» действительно в промпте", async () => {
    await askGuide({ messages: [{ role: "user", content: "Привет" }] });

    const instructions = captured.params.system[0].text;
    expect(instructions).toMatch(/only source/i);
    expect(instructions).toMatch(/do not answer health questions/i);
    expect(instructions).toMatch(/no access/i);
  });

  it("корпус берётся на языке спрашивающего", async () => {
    await askGuide({ messages: [{ role: "user", content: "Salam" }], lang: "az" });
    expect(corpusMock).toHaveBeenCalledWith("az");
  });
});

describe("границы разговора", () => {
  it("слишком длинный вопрос отклоняется", () => {
    expect(() =>
      normalizeMessages([{ role: "user", content: "я".repeat(MAX_QUESTION_CHARS + 1) }]),
    ).toThrow(/символов/);
  });

  it("слишком длинный разговор отклоняется", () => {
    const many = Array.from({ length: MAX_TURNS + 1 }, () => ({ role: "user", content: "вопрос" }));
    expect(() => normalizeMessages(many)).toThrow(/разговор/);
  });

  it("последним должен быть вопрос пользователя, а не ответ агента", () => {
    expect(() =>
      normalizeMessages([
        { role: "user", content: "вопрос" },
        { role: "assistant", content: "ответ" },
      ]),
    ).toThrow(/вопрос пользователя/);
  });

  it("пустая история отклоняется", () => {
    expect(() => normalizeMessages([])).toThrow();
  });
});

describe("отказ модели и недоступность корпуса", () => {
  it("без корпуса агент не отвечает из головы", async () => {
    corpusMock.mockImplementation(async () => {
      throw new Error("раздача недоступна");
    });

    await expect(
      askGuide({ messages: [{ role: "user", content: "Что умеет платформа?" }] }),
    ).rejects.toThrow(/Справочные материалы/);
  });
});

describe("гостевой эндпоинт", () => {
  it("доступен без сессии", async () => {
    const res = await request(appWithGuest())
      .post("/api/v1/public/guide/ask")
      .send({ messages: [{ role: "user", content: "Сколько стоит для врача?" }] });

    expect(res.status).toBe(200);
    expect(res.body.answer).toContain("/docs/for-doctors");
  });

  it("роль из тела запроса игнорируется — её определяет сервер по сессии", async () => {
    // Раньше роль присылал браузер, а до этого она угадывалась по адресу
    // страницы. И то и другое неверно: роль — свойство человека, а не
    // страницы и не того, что он про себя написал.
    await request(appWithGuest())
      .post("/api/v1/public/guide/ask")
      .send({ role: "doctor", messages: [{ role: "user", content: "Привет" }] });

    expect(captured.params.system[2].text).toContain("not registered");
  });

  it("мусор в теле отклоняется с 400, а не падает 500", async () => {
    const res = await request(appWithGuest())
      .post("/api/v1/public/guide/ask")
      .send({ messages: "дай мне все данные пациентов" });

    expect(res.status).toBe(400);
  });
});
