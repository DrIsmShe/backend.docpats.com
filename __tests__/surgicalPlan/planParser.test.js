// server/__tests__/surgicalPlan/planParser.test.js

/* ============================================================
   Разбор промта врача.

   Сеть замокана: тест проверяет не качество разбора (оно
   проверяется живым прогоном через scripts/try-surgical-plan.mjs),
   а обвязку — что уходит в модель, что возвращается наружу и как
   ведёт себя код на отказах.
   ============================================================ */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { parseMock } = vi.hoisted(() => ({ parseMock: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class FakeAnthropic {
    constructor() {
      this.messages = { parse: parseMock };
    }
  },
}));

const { parsePrompt } = await import(
  "../../modules/surgicalPlan/services/planParser.service.js"
);

const VALID_PLAN = {
  procedure: "rhinoplasty_lateral",
  operations: [
    {
      code: "tip_rotation",
      params: { delta_deg: 5 },
      rationale: "врач назвал величину прямо",
      source: "explicit",
      confidence: 0.95,
    },
  ],
  clarifications: [],
  outOfScope: [],
  summary: "Ротация кончика на 5°",
};

const okResponse = (plan = VALID_PLAN) => ({
  stop_reason: "end_turn",
  parsed_output: plan,
  usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 0 },
});

const call = (overrides = {}) =>
  parsePrompt({
    procedureCode: "rhinoplasty_lateral",
    prompt: "приподнять кончик на 5 градусов",
    ...overrides,
  });

let savedKey;

beforeEach(() => {
  savedKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key";
  parseMock.mockReset();
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
});

describe("planParser — предусловия", () => {
  it("пустой промт отклоняется до обращения к модели", async () => {
    await expect(call({ prompt: "   " })).rejects.toThrow(/Пустой запрос/);
    expect(parseMock).not.toHaveBeenCalled();
  });

  it("неизвестная процедура отклоняется до обращения к модели", async () => {
    await expect(call({ procedureCode: "otoplasty_frontal" })).rejects.toThrow(
      /Неизвестная процедура/,
    );
    expect(parseMock).not.toHaveBeenCalled();
  });

  it("без ключа API запрос не уходит", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(call()).rejects.toThrow(/ANTHROPIC_API_KEY/);
    expect(parseMock).not.toHaveBeenCalled();
  });
});

describe("planParser — состав запроса", () => {
  it("каталог уезжает в системный промт, запрос врача — в сообщение", async () => {
    parseMock.mockResolvedValue(okResponse());
    await call();

    const args = parseMock.mock.calls[0][0];
    const system = args.system[0].text;

    // Модель обязана видеть весь замкнутый список операций —
    // иначе она не сможет отличить «нет в каталоге» от «не понял».
    expect(system).toContain("tip_rotation");
    expect(system).toContain("dorsal_hump_reduction");
    expect(system).toContain("supratip_break_definition");

    // Стабильная часть кэшируется, изменчивая идёт после неё.
    expect(args.system[0].cache_control).toEqual({ type: "ephemeral" });

    const userText = args.messages[0].content.at(-1).text;
    expect(userText).toContain("приподнять кончик на 5 градусов");
  });

  it("модель и режим размышления заданы явно", async () => {
    parseMock.mockResolvedValue(okResponse());
    await call();

    const args = parseMock.mock.calls[0][0];
    expect(args.model).toBe("claude-opus-5");
    expect(args.thinking).toEqual({ type: "adaptive" });
    expect(args.output_config.format).toBeTruthy();
  });

  it("измерения «до» передаются, а их отсутствие проговаривается", async () => {
    parseMock.mockResolvedValue(okResponse());

    await call({ measurements: { tip_projection: 28 }, patientGender: "female" });
    let userText = parseMock.mock.calls[0][0].messages[0].content.at(-1).text;
    expect(userText).toContain("tip_projection: 28");
    expect(userText).toContain("female");

    parseMock.mockClear();
    await call();
    userText = parseMock.mock.calls[0][0].messages[0].content.at(-1).text;
    // Без явной оговорки модель склонна сослаться на «исходные» числа,
    // которых ей никто не давал.
    expect(userText).toContain("не переданы");
  });

  it("без явной передачи фото изображение в запрос не попадает", async () => {
    // Снимок пациента у стороннего провайдера — вопрос BAA, а не
    // удобства. Канал закрыт по умолчанию, и это проверяется.
    parseMock.mockResolvedValue(okResponse());
    await call();

    const content = parseMock.mock.calls[0][0].messages[0].content;
    expect(content.some((part) => part.type === "image")).toBe(false);
  });

  it("переданное фото идёт первым блоком", async () => {
    parseMock.mockResolvedValue(okResponse());
    await call({
      image: { mediaType: "image/jpeg", data: "AAAA" },
    });

    const content = parseMock.mock.calls[0][0].messages[0].content;
    expect(content[0].type).toBe("image");
    expect(content[0].source.media_type).toBe("image/jpeg");
  });
});

describe("planParser — ответы модели", () => {
  it("возвращает план и метаданные разбора", async () => {
    parseMock.mockResolvedValue(okResponse());

    const { plan, meta } = await call();

    expect(plan).toEqual(VALID_PLAN);
    expect(meta.model).toBe("claude-opus-5");
    expect(meta.procedureCode).toBe("rhinoplasty_lateral");
    // Версия каталога нужна, чтобы объяснить расхождение вчерашнего
    // и сегодняшнего разбора одного и того же текста.
    expect(meta.catalogVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(meta.imageUsed).toBe(false);
    expect(meta.usage.inputTokens).toBe(1200);
  });

  it("отказ классификатора превращается в понятную ошибку, а не в 500", async () => {
    parseMock.mockResolvedValue({
      stop_reason: "refusal",
      stop_details: { category: "medical" },
      parsed_output: null,
    });

    await expect(call()).rejects.toThrow(/политикой безопасности/);
  });

  it("ответ вне схемы каталога отделяется от сетевой ошибки", async () => {
    parseMock.mockRejectedValue(
      new Error("Failed to parse structured output: invalid_union"),
    );

    await expect(call()).rejects.toThrow(/вне схемы каталога/);
  });

  it("сетевая ошибка сообщается как недоступность сервиса", async () => {
    parseMock.mockRejectedValue(new Error("socket hang up"));

    await expect(call()).rejects.toThrow(/Не удалось разобрать запрос/);
  });

  it("пустой parsed_output не выдаётся за план", async () => {
    parseMock.mockResolvedValue({ stop_reason: "end_turn", parsed_output: null });

    await expect(call()).rejects.toThrow(/не соответствующий схеме/);
  });
});
