// __tests__/translation/translateWithAI.test.js
//
// Перевод статьи моделью. Держатся три вещи.
//
// 1. СБОЙ НЕ ВЫДАЁТСЯ ЗА УСПЕХ. Давняя версия ловила любую ошибку и
//    возвращала ИСХОДНЫЙ текст: воркер получал «перевод», сохранял его как
//    готовый, очередь считала работу сделанной и не повторяла. Статья
//    оставалась на языке оригинала без единой пометки.
//
// 2. ПРОВАЙДЕРА ВЫБИРАЕТ НАСТРОЙКА, А НЕ ИМПОРТ. Перевод сидел на OpenAI —
//    единственная подсистема, оставшаяся там, — и 8 сентября 2026 на том
//    счету кончились деньги: воркер получал 429 на каждой задаче, а в
//    интерфейсе это выглядело как «статьи почему-то не переводятся».
//    Теперь провайдер меняется в админке и действует со следующего задания.
//
// 3. МОДЕЛЬ ПРИХОДИТ СВЕРХУ. Имя модели живёт в общей таблице назначений,
//    а не константой внутри реализации: иначе смена модели снова стала бы
//    правкой кода в двух местах.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { streamMock, провайдерМок } = vi.hoisted(() => ({
  streamMock: vi.fn(),
  провайдерМок: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor() {
      this.beta = { messages: { stream: streamMock } };
    }
  },
}));

vi.mock("../../common/ai/provider.js", () => ({
  провайдерДля: провайдерМок,
}));

const { translate } = await import(
  "../../modules/translation/translation.provider.js"
);

/** Ответ модели: structured output приходит текстовым блоком. */
const ok = (payload, stop_reason = "end_turn") => ({
  finalMessage: async () => ({
    stop_reason,
    content: [{ type: "text", text: JSON.stringify(payload) }],
  }),
});

const SHORT = {
  title: "Талассемия",
  abstract: "Наследственная анемия",
  content: "Короткий текст статьи.",
  fromLanguage: "ru",
  toLanguage: "az",
};

beforeEach(() => {
  streamMock.mockReset();
  провайдерМок.mockReset();
  провайдерМок.mockResolvedValue({
    provider: "anthropic",
    model: "claude-sonnet-5",
    fixed: false,
  });
});

describe("перевод статьи", () => {
  it("возвращает переведённые поля", async () => {
    streamMock.mockReturnValue(
      ok({
        title: "Talassemiya",
        abstract: "İrsi anemiya",
        content: "Məqalənin qısa mətni.",
      }),
    );

    expect(await translate(SHORT)).toEqual({
      title: "Talassemiya",
      abstract: "İrsi anemiya",
      content: "Məqalənin qısa mətni.",
    });
  });

  it("идёт к тому провайдеру и той модели, которые выбраны в настройке", async () => {
    провайдерМок.mockResolvedValue({
      provider: "anthropic",
      model: "claude-opus-5",
      fixed: false,
    });
    streamMock.mockReturnValue(ok({ title: "T", abstract: "A", content: "C" }));

    await translate(SHORT);

    expect(провайдерМок).toHaveBeenCalledWith("translation");
    expect(streamMock.mock.calls[0][0].model).toBe("claude-opus-5");
  });

  it("просит структурированный ответ, а не JSON на честном слове", async () => {
    streamMock.mockReturnValue(ok({ title: "T", abstract: "A", content: "C" }));

    await translate(SHORT);

    const [args] = streamMock.mock.calls[0];
    expect(args.output_config?.format?.type).toBe("json_schema");
    expect(args.output_config.format.schema.required).toEqual([
      "title",
      "abstract",
      "content",
    ]);
    // Обрыв по длине — это битый ответ, а не «немного короче», поэтому
    // потолок задаётся явно.
    expect(args.max_tokens).toBeGreaterThan(0);
  });

  it("сбой модели поднимается наверх, а НЕ подменяется оригиналом", async () => {
    streamMock.mockImplementation(() => {
      throw new Error("429 no credits remaining");
    });

    await expect(translate(SHORT)).rejects.toThrow(/429/);
  });

  it("обрыв по длине распознаётся отдельно — он лечится не повтором", async () => {
    streamMock.mockReturnValue(ok({}, "max_tokens"));

    await expect(translate(SHORT)).rejects.toThrow(/пределе длины/i);
  });

  it("отказ модели не превращается в пустой перевод", async () => {
    streamMock.mockReturnValue({
      finalMessage: async () => ({
        stop_reason: "refusal",
        stop_details: { category: "medical" },
        content: [],
      }),
    });

    await expect(translate(SHORT)).rejects.toThrow(/отклонила/i);
  });

  it("пустой ответ — ошибка, а не статья без текста", async () => {
    streamMock.mockReturnValue({
      finalMessage: async () => ({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "   " }],
      }),
    });

    await expect(translate(SHORT)).rejects.toThrow(/пустой ответ/i);
  });

  it("длинная статья режется на куски, заголовок переводится отдельным вызовом", async () => {
    streamMock.mockImplementation(({ messages }) => {
      const текст = messages[0].content;
      // Вызов ради заголовка — единственный, где TITLE не пуст.
      const мета = /TITLE:\n.+/.test(текст);
      return ok({
        title: мета ? "Talassemiya" : "",
        abstract: мета ? "İrsi anemiya" : "",
        content: мета ? "meta" : "hissə",
      });
    });

    const итог = await translate({
      ...SHORT,
      content: "абзац. ".repeat(6000),
    });

    expect(streamMock.mock.calls.length).toBeGreaterThan(1);
    expect(итог.title).toBe("Talassemiya");
    expect(итог.abstract).toBe("İrsi anemiya");
    // Тело собрано из кусков, а не из мета-вызова.
    expect(итог.content).toContain("hissə");
    expect(итог.content).not.toBe("meta");
  });

  it("выбор OpenAI в настройке уводит перевод к другой реализации", async () => {
    // Мостик существует ради этого: смена провайдера не должна быть
    // правкой кода.
    провайдерМок.mockResolvedValue({
      provider: "openai",
      model: "gpt-4o-mini",
      fixed: false,
    });

    // Claude-клиент при этом не трогаем вовсе.
    await expect(translate(SHORT)).rejects.toBeTruthy();
    expect(streamMock).not.toHaveBeenCalled();
  });
});
