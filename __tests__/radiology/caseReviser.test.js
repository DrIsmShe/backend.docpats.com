// __tests__/radiology/caseReviser.test.js
//
// Третий проход (ai/caseReviser.js). Вызов Anthropic мокируем — проверяется
// слой вокруг модели, а он здесь отвечает за три вещи:
//
//   1) замечания и УКАЗАНИЕ АВТОРА доходят до модели в запросе. Указание — то,
//      чем автор выбирает между путями, которые предлагает рецензент («убрать
//      упоминание ГГТП» или «добавить показатель в панель»): выбор врачебный,
//      и потеряться по дороге он не должен;
//   2) обрезанный ответ не применяется. Панель короче двух строк — это потеря
//      данных автора, а не «кейс стал компактнее»;
//   3) отчёт о правках нормализуется: пустые записи выброшены, длины
//      ограничены — иначе дифф, ради которого редактор и отчитывается,
//      превращается в мусор.

import { describe, it, expect, beforeEach, vi } from "vitest";

const finalMessage = vi.fn();
const streamArgs = vi.fn();
vi.mock(
  "../../modules/education/education-ingest/extractors/claude.extractor.js",
  () => ({
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
    describeApiError: (err) => ({ retryable: false, message: String(err?.message ?? err) }),
    withApiRetry: (run, opts) => run(opts?.model),
  }),
);

const { reviseLabCase, reviseVpCase } = await import(
  "../../modules/radiology/ai/caseReviser.js"
);
const { ValidationError } = await import("../../common/utils/errors.js");

function reply(payload) {
  finalMessage.mockResolvedValue({
    stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify(payload) }],
    usage: { input_tokens: 100, output_tokens: 50 },
  });
}

const draft = {
  title: "Острый вирусный гепатит A",
  clinicalContext: "Мужчина 24 лет, желтуха после поездки.",
  panel: [
    { name: "АЛТ", value: "1240", unit: "Ед/л", refRange: "0–41", significant: true },
    { name: "Щелочная фосфатаза", value: "126", unit: "Ед/л", refRange: "40–130", significant: false },
  ],
  impression: {
    correctText: "Умеренное повышение ГГТП при нормальной ЩФ",
    diagnosisKeys: ["гепатит A"],
    diagnosisSynonyms: [],
  },
};

const issues = [
  {
    target: "impression",
    severity: "error",
    issue: "В разборе указан ГГТП, которого нет в панели",
    suggestion: "Либо добавить ГГТП в панель, либо убрать упоминание",
  },
];

// Ответ редактора: панель с добавленным показателем и отчёт о правке.
const goodReply = {
  title: "Острый вирусный гепатит A",
  clinicalContext: "Мужчина 24 лет, желтуха после поездки.",
  difficulty: "medium",
  panel: [
    { name: "АЛТ", value: "1240", unit: "Ед/л", refRange: "0–41", significant: true },
    { name: "Щелочная фосфатаза", value: "126", unit: "Ед/л", refRange: "40–130", significant: false },
    { name: "ГГТП", value: "88", unit: "Ед/л", refRange: "10–71", significant: true },
  ],
  impression: {
    correctText: "Гепатоцеллюлярное повреждение, ГГТП умеренно повышен",
    diagnosisKeys: ["гепатит A"],
    diagnosisSynonyms: ["hepatitis A"],
  },
  changes: [{ target: "ГГТП", change: "добавлен показатель 88 Ед/л", why: "разбор на него ссылался" }],
  disputed: [],
};

const sentText = () => {
  const msg = streamArgs.mock.calls.at(-1)[0].messages[0];
  return typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
};

beforeEach(() => {
  finalMessage.mockReset();
  streamArgs.mockReset();
});

describe("третий проход: что уходит в модель", () => {
  it("передаёт замечания рецензента с их серьёзностью и предложением", async () => {
    reply(goodReply);
    await reviseLabCase({ draft, issues });

    const text = sentText();
    expect(text).toContain("В разборе указан ГГТП, которого нет в панели");
    expect(text).toContain("Предложение рецензента: Либо добавить ГГТП");
    expect(text).toContain("[ошибка]");
  });

  it("указание автора доходит и объявлено главнее рецензента", async () => {
    reply(goodReply);
    await reviseLabCase({
      draft,
      issues,
      hint: "ГГТП добавь в панель, а не убирай из разбора",
    });

    const text = sentText();
    expect(text).toContain("УКАЗАНИЕ АВТОРА");
    expect(text).toContain("ГГТП добавь в панель");
  });

  it("без указания лишнего блока в запросе нет", async () => {
    reply(goodReply);
    await reviseLabCase({ draft, issues });
    expect(sentText()).not.toContain("УКАЗАНИЕ АВТОРА");
  });

  it("правка без единого замечания бессмысленна — модель не вызывается", async () => {
    await expect(reviseLabCase({ draft, issues: [] })).rejects.toThrow(ValidationError);
    expect(streamArgs).not.toHaveBeenCalled();
  });
});

describe("третий проход: что принимается обратно", () => {
  it("возвращает исправленный кейс и отчёт о правках", async () => {
    reply(goodReply);
    const out = await reviseLabCase({ draft, issues });

    expect(out.draft.panel).toHaveLength(3);
    expect(out.draft.panel[2].name).toBe("ГГТП");
    expect(out.draft.impression.correctText).toContain("ГГТП умеренно повышен");
    expect(out.changes[0].change).toContain("добавлен показатель");
  });

  it("обрезанную панель не применяет — это потеря данных автора", async () => {
    reply({ ...goodReply, panel: [goodReply.panel[0]] });
    await expect(reviseLabCase({ draft, issues })).rejects.toThrow(/слишком короткую панель/);
  });

  it("несогласие редактора возвращается отдельно от правок", async () => {
    reply({
      ...goodReply,
      changes: [],
      disputed: [{ issue: "ЩФ 126 — холестаз", why: "126 при референсе 40–130 это норма" }],
    });
    const out = await reviseLabCase({ draft, issues });

    expect(out.changes).toHaveLength(0);
    expect(out.disputed).toHaveLength(1);
    expect(out.disputed[0].why).toContain("норма");
  });

  it("пустые записи отчёта отбрасываются: дифф читают глазами", async () => {
    reply({
      ...goodReply,
      changes: [{ target: "", change: "", why: "" }, goodReply.changes[0]],
      disputed: [{ issue: "есть текст", why: "" }],
    });
    const out = await reviseLabCase({ draft, issues });

    expect(out.changes).toHaveLength(1);
    // Возражение без обоснования — не возражение.
    expect(out.disputed).toHaveLength(0);
  });
});

describe("третий проход: виртуальный пациент", () => {
  const vpDraft = {
    title: "Боль в правой подвздошной области",
    presentation: "Мужчина 22 лет.",
    investigations: [
      { name: "Общий анализ крови", category: "Лаборатория", resultText: "Лейкоцитоз 14", necessary: true },
      { name: "МРТ головного мозга", category: "Лучевая", resultText: "Без патологии", necessary: false },
    ],
    diagnosis: { correctText: "Острый аппендицит", diagnosisKeys: ["аппендицит"], diagnosisSynonyms: [] },
  };

  it("правит сценарий и сохраняет полный список обследований", async () => {
    reply({
      title: vpDraft.title,
      presentation: vpDraft.presentation,
      difficulty: "easy",
      investigations: [
        { name: "Общий анализ крови", category: "Лаборатория", resultText: "Лейкоцитоз 14,2", necessary: true },
        { name: "УЗИ брюшной полости", category: "Лучевая", resultText: "Аппендикс 9 мм", necessary: true },
        { name: "МРТ головного мозга", category: "Лучевая", resultText: "Без патологии", necessary: false },
      ],
      diagnosis: {
        correctText: "Острый аппендицит",
        diagnosisKeys: ["аппендицит"],
        diagnosisSynonyms: ["appendicitis"],
      },
      changes: [{ target: "УЗИ брюшной полости", change: "добавлено", why: "без него диагноз не поставить" }],
      disputed: [],
    });

    const out = await reviseVpCase({
      draft: vpDraft,
      issues: [
        {
          target: "case",
          severity: "error",
          issue: "Набор necessary не позволяет прийти к диагнозу",
          suggestion: "Добавить визуализацию",
        },
      ],
    });

    expect(out.draft.investigations).toHaveLength(3);
    expect(out.draft.investigations.filter((i) => i.necessary)).toHaveLength(2);
    expect(out.changes[0].target).toBe("УЗИ брюшной полости");
  });

  it("сценарий короче двух обследований не применяется", async () => {
    reply({
      title: vpDraft.title,
      presentation: vpDraft.presentation,
      difficulty: "easy",
      investigations: [vpDraft.investigations[0]],
      diagnosis: vpDraft.diagnosis,
      changes: [],
      disputed: [],
    });

    await expect(
      reviseVpCase({ draft: vpDraft, issues }),
    ).rejects.toThrow(/меньше двух обследований/);
  });
});
