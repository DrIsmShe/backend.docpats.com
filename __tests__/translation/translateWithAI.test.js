// __tests__/translation/translateWithAI.test.js
//
// Перевод статьи моделью. Главное, что здесь держится, — СБОЙ НЕ ВЫДАЁТСЯ ЗА
// УСПЕХ.
//
// Прежняя версия ловила любую ошибку и возвращала ИСХОДНЫЙ текст. Воркер
// получал «перевод», сохранял его как готовый, очередь считала работу
// сделанной и не повторяла. Статья оставалась на языке оригинала без единой
// пометки: узнать об этом можно было только глазами или по строке в логе
// «❌ Chunk translation failed». Азербайджанские версии статей так и жили
// непереведёнными.
//
// Теперь ошибка идёт наверх: у задания attempts: 3 (translation.service.js),
// а окончательно упавшее остаётся в failed-очереди видимым.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("openai", () => ({
  default: class {
    constructor() {
      this.chat = { completions: { create: createMock } };
    }
  },
}));

const { translateWithAI } = await import(
  "../../modules/translation/translateWithAI.js"
);

const ok = (payload) => ({
  choices: [
    {
      finish_reason: "stop",
      message: { content: JSON.stringify(payload) },
    },
  ],
});

const SHORT = {
  title: "Талассемия",
  abstract: "Наследственная анемия",
  content: "Короткий текст статьи.",
  fromLanguage: "ru",
  toLanguage: "az",
};

beforeEach(() => {
  createMock.mockReset();
});

describe("перевод статьи", () => {
  it("возвращает переведённые поля", async () => {
    createMock.mockResolvedValue(
      ok({
        title: "Talassemiya",
        abstract: "İrsi anemiya",
        content: "Məqalənin qısa mətni.",
      }),
    );

    const out = await translateWithAI(SHORT);

    expect(out).toEqual({
      title: "Talassemiya",
      abstract: "İrsi anemiya",
      content: "Məqalənin qısa mətni.",
    });
  });

  it("просит у модели структурированный ответ, а не JSON на честном слове", async () => {
    createMock.mockResolvedValue(ok({ title: "T", abstract: "A", content: "C" }));

    await translateWithAI(SHORT);

    const [args] = createMock.mock.calls[0];
    expect(args.response_format?.type).toBe("json_schema");
    expect(args.response_format.json_schema.strict).toBe(true);
    // Обрыв по длине — это битый JSON, а не «немного короче», поэтому потолок
    // ответа задаётся явно.
    expect(args.max_tokens).toBeGreaterThan(0);
  });

  it("сбой модели поднимается наверх, а НЕ подменяется оригиналом", async () => {
    createMock.mockRejectedValue(new Error("429 rate limit"));

    await expect(translateWithAI(SHORT)).rejects.toThrow(/429/);
  });

  it("обрыв по длине распознаётся отдельно — он лечится не повтором", async () => {
    createMock.mockResolvedValue({
      choices: [{ finish_reason: "length", message: { content: "{" } }],
    });

    await expect(translateWithAI(SHORT)).rejects.toThrow(/пределе длины/i);
  });

  it("отказ модели не превращается в пустой перевод", async () => {
    createMock.mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { refusal: "not allowed" } }],
    });

    await expect(translateWithAI(SHORT)).rejects.toThrow(/отклонила/i);
  });

  it("пустой ответ — ошибка, а не статья без текста", async () => {
    createMock.mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { content: "   " } }],
    });

    await expect(translateWithAI(SHORT)).rejects.toThrow(/пустой ответ/i);
  });

  it("длинная статья режется на куски, заголовок переводится отдельным вызовом", async () => {
    createMock.mockImplementation(async ({ messages }) => {
      const user = messages[1].content;
      // Вызов ради заголовка — единственный, где TITLE не пуст.
      const isMeta = /TITLE:\n.+/.test(user);
      return ok({
        title: isMeta ? "Talassemiya" : "",
        abstract: isMeta ? "İrsi anemiya" : "",
        content: isMeta ? "meta" : "hissə",
      });
    });

    const out = await translateWithAI({
      ...SHORT,
      content: "абзац. ".repeat(3000),
    });

    // Больше одного вызова: куски плюс отдельный вызов за заголовком.
    expect(createMock.mock.calls.length).toBeGreaterThan(1);
    expect(out.title).toBe("Talassemiya");
    expect(out.abstract).toBe("İrsi anemiya");
    // Тело собрано из кусков, а не из мета-вызова.
    expect(out.content).toContain("hissə");
    expect(out.content).not.toBe("meta");
  });
});
