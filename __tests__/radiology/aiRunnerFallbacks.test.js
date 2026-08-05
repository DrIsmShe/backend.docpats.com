// __tests__/radiology/aiRunnerFallbacks.test.js
//
// Запасная модель при отказе классификаторов и честная запись того, кто
// ответил.
//
// Зачем тест: обе вещи невидимы в обычной работе и тихо отваливаются при
// правке. Если из запроса пропадёт fallbacks, врач просто начнёт иногда
// получать «ИИ отказался» на клиническом материале — и это спишут на модель.
// Если перестанет записываться реально ответившая модель, происхождение
// вывода начнёт врать: в карточке будет стоять одна модель, а отвечала другая.

import { describe, it, expect, vi, beforeEach } from "vitest";

const finalMessage = vi.fn();
const streamSpy = vi.fn(() => ({ finalMessage }));

vi.mock("../../modules/education/education-ingest/extractors/claude.extractor.js", () => ({
  getClient: () => ({ beta: { messages: { stream: streamSpy } } }),
  describeApiError: (err) => ({ retryable: false, message: String(err?.message ?? err) }),
  // Повтор при перегрузке здесь не проверяется — важно лишь то, что модель
  // доходит до запроса. Настоящая обёртка ждала бы секунды между попытками.
  withApiRetry: (run, opts) => run(opts?.model),
}));

const { runJson, MODEL } = await import("../../modules/radiology/ai/aiRunner.js");
const { ValidationError } = await import("../../common/utils/errors.js");

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ok"],
  properties: { ok: { type: "boolean" } },
};

function call() {
  return runJson({ system: "s", instruction: "i", schema: SCHEMA, what: "кейс" });
}

function reply({ model = MODEL, stopReason = "end_turn" } = {}) {
  finalMessage.mockResolvedValue({
    model,
    stop_reason: stopReason,
    content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
    usage: { input_tokens: 5, output_tokens: 7 },
  });
}

beforeEach(() => {
  streamSpy.mockClear();
  finalMessage.mockReset();
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.ANTHROPIC_FALLBACKS;
});

describe("запрос к модели", () => {
  it("идёт бета-путём и просит запасную модель на случай отказа", async () => {
    reply();
    await call();

    const params = streamSpy.mock.calls[0][0];
    expect(params.fallbacks).toBe("default");
    expect(params.betas).toContain("server-side-fallback-2026-07-01");
  });

  it("сохраняет всё, от чего зависит форма ответа", async () => {
    reply();
    await call();

    const params = streamSpy.mock.calls[0][0];
    // Структурированный вывод: без него разбор JSON становится гаданием.
    expect(params.output_config.format.type).toBe("json_schema");
    // Адаптивное мышление, а не budget_tokens: последний на Opus 5 даёт 400.
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params).not.toHaveProperty("temperature");
    expect(params).not.toHaveProperty("top_p");
  });
});

describe("кто ответил", () => {
  it("возвращается модель из ответа, а не та, которую просили", async () => {
    // Так выглядит сработавший fallback: просили одну, ответила другая.
    reply({ model: "claude-opus-4-8" });
    const res = await call();
    expect(res.model).toBe("claude-opus-4-8");
    expect(res.model).not.toBe(MODEL);
  });

  it("если модель в ответе не пришла — подставляется запрошенная", async () => {
    finalMessage.mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
      usage: {},
    });
    expect((await call()).model).toBe(MODEL);
  });
});

describe("уровень усилий и пределы", () => {
  it("не задан — поле в запрос не уходит", async () => {
    // Отсутствие поля и явное "high" сегодня совпадают по значению, но не по
    // смыслу: в запросе должно быть видно, выбирал уровень вызывающий код или
    // нет. Иначе при смене умолчания API поведение поедет незаметно.
    reply();
    await call();
    expect(streamSpy.mock.calls[0][0].output_config).not.toHaveProperty("effort");
  });

  it("задан — уходит внутри output_config, а не верхним уровнем", async () => {
    reply();
    await runJson({ system: "s", instruction: "i", schema: SCHEMA, what: "кейс", effort: "low" });
    const params = streamSpy.mock.calls.at(-1)[0];
    expect(params.output_config.effort).toBe("low");
    expect(params).not.toHaveProperty("effort");
  });

  it("переполнение контекста отличается от обрыва ответа", async () => {
    // Разные причины и разные советы: в одном случае сокращать материал, в
    // другом — ответ. Один текст на оба случая уводит врача не туда.
    reply({ stopReason: "model_context_window_exceeded" });
    await expect(call()).rejects.toThrow(/не помещается|сократите исходный/i);

    reply({ stopReason: "max_tokens" });
    await expect(call()).rejects.toThrow(/предел[еа] длины/i);
  });
});

describe("отказ и выключатель", () => {
  it("отказ всей цепочки — понятная ошибка, а не пустой результат", async () => {
    reply({ stopReason: "refusal" });
    await expect(call()).rejects.toBeInstanceOf(ValidationError);
    await expect(call()).rejects.toThrow(/отказался/i);
  });

  it("ANTHROPIC_FALLBACKS=off убирает бета-параметры из запроса", async () => {
    // Аварийный выключатель: если бета станет недоступна, без него это 400
    // на каждый вызов модели в проде.
    process.env.ANTHROPIC_FALLBACKS = "off";
    vi.resetModules();
    const { runJson: runJsonOff } = await import("../../modules/radiology/ai/aiRunner.js");

    reply();
    await runJsonOff({ system: "s", instruction: "i", schema: SCHEMA, what: "кейс" });

    const params = streamSpy.mock.calls.at(-1)[0];
    expect(params).not.toHaveProperty("fallbacks");
    expect(params).not.toHaveProperty("betas");
  });
});
