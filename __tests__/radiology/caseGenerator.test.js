// __tests__/radiology/caseGenerator.test.js
//
// ИИ-генерация кейса целиком (ai/caseGenerator.js). Сам вызов Anthropic
// мокируем: проверяем не качество кейса, а слой нормализации вокруг модели —
// именно он защищает базу от мусора, если модель ответила не так, как ждали.
//
// Что здесь важно: коды находок принимаются ТОЛЬКО из словаря модальности
// (иначе палитра в ридере не сможет их показать, а скоринг — сравнить), а
// слишком короткая панель/список обследований отвергаются, потому что такой
// кейс всё равно не пройдёт гейт публикации.

import { describe, it, expect, beforeEach, vi } from "vitest";

// Мок клиента Anthropic — до импорта генератора, чтобы настоящий SDK и сеть
// не подгружались.
const finalMessage = vi.fn();
vi.mock(
  "../../modules/education/education-ingest/extractors/claude.extractor.js",
  () => ({
    getClient: () => ({ messages: { stream: () => ({ finalMessage }) } }),
    describeApiError: (err) => ({
      retryable: false,
      message: String(err?.message ?? err),
    }),
  }),
);

const { generateLabCase, generateVpCase, generateRadiologyCase } = await import(
  "../../modules/radiology/ai/caseGenerator.js"
);
const { ValidationError, ServiceUnavailableError } = await import(
  "../../common/utils/errors.js"
);

// Ответ «модели»: форму гарантируют structured outputs, поэтому в тестах
// подставляем именно JSON-текст, как его вернул бы API.
function reply(payload, { stopReason = "end_turn" } = {}) {
  finalMessage.mockResolvedValue({
    stop_reason: stopReason,
    content: [{ type: "text", text: JSON.stringify(payload) }],
    usage: { input_tokens: 10, output_tokens: 20 },
  });
}

function rawReply(text, { stopReason = "end_turn" } = {}) {
  finalMessage.mockResolvedValue({
    stop_reason: stopReason,
    content: [{ type: "text", text }],
    usage: { input_tokens: 10, output_tokens: 20 },
  });
}

const labPayload = (overrides = {}) => ({
  title: "Анемия у молодой женщины",
  clinicalContext: "Женщина 27 лет, слабость полгода.",
  difficulty: "medium",
  panel: [
    { name: "Гемоглобин", value: "92", unit: "г/л", refRange: "120–150", significant: true },
    { name: "Ферритин", value: "4", unit: "нг/мл", refRange: "15–150", significant: true },
    { name: "Лейкоциты", value: "6.4", unit: "×10⁹/л", refRange: "4–9", significant: false },
  ],
  impression: {
    correctText: "Микроцитарная анемия.",
    diagnosisKeys: ["жда", "железодефицитная анемия"],
    diagnosisSynonyms: ["iron deficiency anemia"],
  },
  ...overrides,
});

const vpPayload = (overrides = {}) => ({
  title: "Одышка у курильщика",
  presentation: "Мужчина 60 лет, одышка 3 года.",
  difficulty: "hard",
  investigations: [
    { name: "Спирометрия", category: "Функциональная", resultText: "ОФВ1/ФЖЕЛ 0,49", necessary: true },
    { name: "D-димер", category: "Лаборатория", resultText: "0,28 мкг/мл — норма", necessary: false },
  ],
  diagnosis: {
    correctText: "ХОБЛ.",
    diagnosisKeys: ["хобл"],
    diagnosisSynonyms: ["copd"],
  },
  ...overrides,
});

const radPayload = (overrides = {}) => ({
  title: "Пневмоторакс справа",
  clinicalContext: "Мужчина 22 лет, резкая боль в груди.",
  difficulty: "easy",
  plannedFindings: [
    {
      label: "pneumothorax",
      significance: "critical",
      location: "правое лёгочное поле, верхушечно",
      explanation: "Линия висцеральной плевры.",
    },
  ],
  impression: {
    correctText: "Справа пневмоторакс.",
    diagnosisKeys: ["пневмоторакс"],
    diagnosisSynonyms: ["pneumothorax"],
  },
  ...overrides,
});

beforeEach(() => {
  finalMessage.mockReset();
  // isConfigured() читает env в момент вызова — ключ должен «быть».
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
});

describe("ИИ-генерация: станция «Анализы»", () => {
  it("нормализует панель и эталон", async () => {
    reply(labPayload());
    const draft = await generateLabCase({ topic: "жда у молодой женщины" });

    expect(draft.title).toBe("Анемия у молодой женщины");
    expect(draft.difficulty).toBe("medium");
    expect(draft.panel).toHaveLength(3);
    expect(draft.panel[0]).toEqual({
      name: "Гемоглобин",
      value: "92",
      unit: "г/л",
      refRange: "120–150",
      significant: true,
    });
    expect(draft.impression.diagnosisKeys).toEqual(["жда", "железодефицитная анемия"]);
    expect(draft.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
  });

  it("выбрасывает показатели без названия или значения и чистит списки диагноза", async () => {
    reply(
      labPayload({
        panel: [
          ...labPayload().panel,
          { name: "  ", value: "10", unit: "", refRange: "", significant: true },
          { name: "Без значения", value: "   ", unit: "", refRange: "", significant: false },
        ],
        impression: {
          correctText: "  Текст с пробелами  ",
          diagnosisKeys: ["  жда  ", "", "   "],
          diagnosisSynonyms: [],
        },
      }),
    );
    const draft = await generateLabCase({ topic: "жда" });

    expect(draft.panel).toHaveLength(3); // две пустые строки отброшены
    expect(draft.impression.correctText).toBe("Текст с пробелами");
    expect(draft.impression.diagnosisKeys).toEqual(["жда"]);
    expect(draft.impression.diagnosisSynonyms).toEqual([]);
  });

  it("приводит significant к boolean, а неизвестную сложность — к medium", async () => {
    reply(
      labPayload({
        difficulty: "невозможная",
        panel: [
          { name: "Hb", value: "92", unit: "", refRange: "", significant: "да" },
          { name: "Ферритин", value: "4", unit: "", refRange: "", significant: 0 },
        ],
      }),
    );
    const draft = await generateLabCase({ topic: "жда" });

    expect(draft.difficulty).toBe("medium");
    expect(draft.panel.map((p) => p.significant)).toEqual([true, false]);
  });

  it("отвергает панель короче двух показателей", async () => {
    reply(labPayload({ panel: [labPayload().panel[0]] }));
    await expect(generateLabCase({ topic: "жда" })).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
  });

  it("требует тему кейса", async () => {
    await expect(generateLabCase({ topic: "   " })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(finalMessage).not.toHaveBeenCalled();
  });
});

describe("ИИ-генерация: «Виртуальный пациент»", () => {
  it("нормализует обследования и диагноз", async () => {
    reply(vpPayload());
    const draft = await generateVpCase({ topic: "одышка у курильщика" });

    expect(draft.difficulty).toBe("hard");
    expect(draft.investigations).toHaveLength(2);
    expect(draft.investigations.map((i) => i.necessary)).toEqual([true, false]);
    expect(draft.diagnosis.diagnosisKeys).toEqual(["хобл"]);
  });

  it("выбрасывает обследования без названия и отвергает список короче двух", async () => {
    reply(
      vpPayload({
        investigations: [vpPayload().investigations[0], { name: "  ", resultText: "x" }],
      }),
    );
    await expect(generateVpCase({ topic: "одышка" })).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
  });
});

describe("ИИ-генерация: лучевой кейс по теме", () => {
  it("отдаёт план находок без геометрии — координаты ставит автор", async () => {
    reply(radPayload());
    const draft = await generateRadiologyCase({ modality: "cxr", topic: "пневмоторакс" });

    expect(draft.plannedFindings).toHaveLength(1);
    expect(draft.plannedFindings[0]).toMatchObject({
      label: "pneumothorax",
      significance: "critical",
    });
    // Ключевое: ИИ не придумывает точку на кадре.
    expect(draft.plannedFindings[0]).not.toHaveProperty("geometry");
    expect(draft.plannedFindings[0].location).toContain("правое");
  });

  it("отбрасывает коды находок вне словаря модальности", async () => {
    reply(
      radPayload({
        plannedFindings: [
          ...radPayload().plannedFindings,
          // выдуманный код
          { label: "unicorn_sign", significance: "major", location: "везде", explanation: "нет" },
          // реальный код, но чужой модальности (ms_lesion — только МРТ)
          { label: "ms_lesion", significance: "major", location: "белое вещество", explanation: "нет" },
        ],
      }),
    );
    const draft = await generateRadiologyCase({ modality: "cxr", topic: "пневмоторакс" });

    expect(draft.plannedFindings.map((f) => f.label)).toEqual(["pneumothorax"]);
  });

  it("приводит неизвестную значимость к major", async () => {
    reply(
      radPayload({
        plannedFindings: [
          { label: "pleural_effusion", significance: "очень важная", location: "базально", explanation: "" },
        ],
      }),
    );
    const draft = await generateRadiologyCase({ modality: "cxr", topic: "выпот" });

    expect(draft.plannedFindings[0].significance).toBe("major");
  });

  it("требует модальность", async () => {
    await expect(
      generateRadiologyCase({ modality: "", topic: "пневмоторакс" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(finalMessage).not.toHaveBeenCalled();
  });
});

describe("ИИ-генерация: ответы модели, которые нельзя принимать", () => {
  it("отказ модели — ошибка валидации, а не пустой кейс", async () => {
    reply(labPayload(), { stopReason: "refusal" });
    await expect(generateLabCase({ topic: "жда" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("обрыв на пределе длины — понятная ошибка, а не битый JSON", async () => {
    // max_tokens ограничивает мышление и текст вместе: обрыв даёт невалидный JSON.
    rawReply('{"title":"Ане', { stopReason: "max_tokens" });
    await expect(generateLabCase({ topic: "жда" })).rejects.toThrow(/оборвался/);
  });

  it("некорректный JSON — сервис недоступен, ничего не сохраняем", async () => {
    rawReply("совсем не json");
    await expect(generateLabCase({ topic: "жда" })).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
  });

  it("без ключа в .env — генерация не запускается", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(generateVpCase({ topic: "одышка" })).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
    expect(finalMessage).not.toHaveBeenCalled();
  });
});
