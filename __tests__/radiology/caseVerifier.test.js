// __tests__/radiology/caseVerifier.test.js
//
// Второй проход (ai/caseVerifier.js). Вызов Anthropic мокируем: проверяется
// слой вокруг модели, а он здесь решает две вещи —
//   1) verdict считается ПО СПИСКУ замечаний, а не по слову модели: иначе UI
//      покажет «замечаний нет» при непустом списке и гейт публикации
//      окажется декоративным;
//   2) severity приводится к перечислению, потому что на нём висит блокировка
//      публикации: неизвестное значение должно деградировать в warning
//      (не блокирует), а не в error (блокирует по ошибке разбора).

import { describe, it, expect, beforeEach, vi } from "vitest";

const finalMessage = vi.fn();
// Запрос к модели перехватываем целиком: проверка соответствия кейса снимку
// живёт именно в payload — попал ли кадр в сообщение и появились ли правила.
const streamArgs = vi.fn();
vi.mock(
  "../../modules/education/education-ingest/extractors/claude.extractor.js",
  () => ({
    // Клиент зовётся через beta-путь: там передаются fallbacks.
    getClient: () => ({
      beta: {
        messages: {
          stream: (args) => {
            streamArgs(args);
            return { finalMessage };
          },
        },
      },
    }),
    describeApiError: (err) => ({
      retryable: false,
      message: String(err?.message ?? err),
    }),
    // Повтор при перегрузке проверяется отдельно (education/apiErrors):
    // здесь он только пропускает вызов дальше, не выжидая пауз.
    withApiRetry: (run, opts) => run(opts?.model),
  }),
);

const { verifyLabCase, verifyVpCase, verifyRadiologyCase } = await import(
  "../../modules/radiology/ai/caseVerifier.js"
);
const { ValidationError } = await import("../../common/utils/errors.js");

function reply(payload) {
  finalMessage.mockResolvedValue({
    stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify(payload) }],
    usage: { input_tokens: 100, output_tokens: 50 },
  });
}

const labDraft = {
  title: "Анемия",
  clinicalContext: "Женщина 27 лет.",
  panel: [
    { name: "Гемоглобин", value: "92", unit: "г/л", refRange: "120–150", significant: true },
    { name: "Ферритин", value: "4", unit: "нг/мл", refRange: "15–150", significant: true },
  ],
  impression: { correctText: "ЖДА", diagnosisKeys: ["жда"], diagnosisSynonyms: [] },
};

beforeEach(() => {
  finalMessage.mockReset();
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
});

describe("второй проход: чистый кейс", () => {
  it("пустой список замечаний → verdict clean", async () => {
    reply({ verdict: "clean", issues: [], summary: "Кейс согласован." });
    const r = await verifyLabCase({ draft: labDraft });

    expect(r.verdict).toBe("clean");
    expect(r.issues).toEqual([]);
    expect(r.errorCount).toBe(0);
    expect(r.summary).toBe("Кейс согласован.");
    expect(r.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
  });
});

describe("второй проход: нормализация замечаний", () => {
  it("verdict считается по списку, а не по слову модели", async () => {
    // Модель сказала clean, но замечания вернула — верим списку.
    reply({
      verdict: "clean",
      issues: [
        { target: "Ферритин", severity: "error", issue: "Противоречит ОЖСС", suggestion: "Поднять ОЖСС" },
      ],
      summary: "",
    });
    const r = await verifyLabCase({ draft: labDraft });

    expect(r.verdict).toBe("issues");
    expect(r.errorCount).toBe(1);
  });

  it("обратный случай: issues без замечаний → clean", async () => {
    reply({ verdict: "issues", issues: [], summary: "" });
    const r = await verifyLabCase({ draft: labDraft });
    expect(r.verdict).toBe("clean");
  });

  it("неизвестная severity деградирует в warning, а не в блокирующую error", async () => {
    reply({
      verdict: "issues",
      issues: [
        { target: "Гемоглобин", severity: "критично!", issue: "Спорное значение", suggestion: "" },
      ],
      summary: "",
    });
    const r = await verifyLabCase({ draft: labDraft });

    expect(r.issues[0].severity).toBe("warning");
    expect(r.errorCount).toBe(0);
  });

  it("замечания без текста отбрасываются", async () => {
    reply({
      verdict: "issues",
      issues: [
        { target: "Гемоглобин", severity: "error", issue: "   ", suggestion: "что-то" },
        { target: "Ферритин", severity: "error", issue: "Реальное замечание", suggestion: "" },
      ],
      summary: "",
    });
    const r = await verifyLabCase({ draft: labDraft });

    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].issue).toBe("Реальное замечание");
    expect(r.errorCount).toBe(1);
  });

  it("считает только error в errorCount", async () => {
    reply({
      verdict: "issues",
      issues: [
        { target: "a", severity: "error", issue: "раз", suggestion: "" },
        { target: "b", severity: "warning", issue: "два", suggestion: "" },
        { target: "c", severity: "error", issue: "три", suggestion: "" },
      ],
      summary: "",
    });
    const r = await verifyLabCase({ draft: labDraft });

    expect(r.issues).toHaveLength(3);
    expect(r.errorCount).toBe(2);
  });
});

describe("второй проход: чего проверять нельзя", () => {
  it("кейс без панели — ошибка валидации, модель не вызывается", async () => {
    await expect(verifyLabCase({ draft: { title: "x" } })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(finalMessage).not.toHaveBeenCalled();
  });

  it("сценарий без обследований — ошибка валидации", async () => {
    await expect(verifyVpCase({ draft: {} })).rejects.toBeInstanceOf(ValidationError);
    expect(finalMessage).not.toHaveBeenCalled();
  });

  it("лучевой кейс без списка находок — ошибка валидации", async () => {
    await expect(
      verifyRadiologyCase({ draft: { title: "x" }, modality: "cxr" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(finalMessage).not.toHaveBeenCalled();
  });

  it("пустой план находок допустим: проверяется текстовая часть", async () => {
    reply({ verdict: "clean", issues: [], summary: "" });
    const r = await verifyRadiologyCase({
      draft: { title: "x", plannedFindings: [], impression: {} },
      modality: "cxr",
    });
    expect(r.verdict).toBe("clean");
  });
});

// Кейс могли собрать по теме, а кадр приложить любой — и текстовый рецензент
// этого не увидит: текст сам по себе безупречен. Проверка «кейс про этот
// снимок?» возможна, только если кадр реально доехал до модели.
describe("второй проход: соответствие кейса снимку", () => {
  const radDraft = {
    title: "Ателектаз правой верхней доли",
    clinicalContext: "Мужчина 64 лет, курильщик.",
    plannedFindings: [{ label: "Ателектаз", significance: "critical" }],
    impression: { correctText: "Ателектаз правой верхней доли", diagnosisKeys: ["ателектаз"] },
  };

  beforeEach(() => {
    streamArgs.mockReset();
    reply({ verdict: "clean", issues: [], summary: "" });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => "image/png" },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
  });

  it("со снимком: кадр уходит в модель ПЕРЕД текстом", async () => {
    await verifyRadiologyCase({
      draft: radDraft,
      modality: "cxr",
      imageUrl: "https://media.docpats.com/uploads/images/x.png",
    });

    const content = streamArgs.mock.calls[0][0].messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    // Порядок важен: текст первым задаёт ожидание и подталкивает «увидеть»
    // описанное — ровно та ошибка, которую рецензент должен ловить.
    expect(content[0].type).toBe("image");
    expect(content[0].source.media_type).toBe("image/png");
    expect(content[1].type).toBe("text");
  });

  it("со снимком: в системный промпт добавлены правила сверки с кадром", async () => {
    await verifyRadiologyCase({
      draft: radDraft,
      modality: "cxr",
      imageUrl: "https://media.docpats.com/uploads/images/x.png",
    });

    const system = streamArgs.mock.calls[0][0].system;
    expect(system).toContain("Снимок приложен");
    expect(system).toMatch(/НЕ видно находки из плана/);
  });

  it("без снимка: запрос остаётся текстовым и правил сверки нет", async () => {
    await verifyRadiologyCase({ draft: radDraft, modality: "cxr" });

    const call = streamArgs.mock.calls[0][0];
    expect(typeof call.messages[0].content).toBe("string");
    expect(call.system).not.toContain("Снимок приложен");
    // Ночной генератор снимка не имеет — лишний сетевой вызов ему не нужен.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("недоступный кадр — понятная ошибка, а не молчаливая проверка по тексту", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    await expect(
      verifyRadiologyCase({
        draft: radDraft,
        modality: "cxr",
        imageUrl: "https://media.docpats.com/uploads/images/gone.png",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    // Молча отрецензировать «по тексту» здесь нельзя: автор решит, что кадр
    // проверен, и опубликует кейс с чужим снимком.
    expect(finalMessage).not.toHaveBeenCalled();
  });
});
