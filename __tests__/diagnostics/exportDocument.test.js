// __tests__/diagnostics/exportDocument.test.js
//
// Документ по делу.
//
// Две вещи здесь важнее оформления.
//
// ПОРЯДОК РАЗДЕЛОВ РАВЕН ОТВЕТСТВЕННОСТИ. Вывод врача идёт перед разбором ИИ.
// Тот, кто откроет файл через год — коллега, юрист, проверяющий, — должен
// увидеть сначала решение врача, а уже потом материал, на котором оно
// строилось. Обратный порядок читается как «программа поставила диагноз, врач
// подписал».
//
// РАЗМЕТКУ В ТЕКСТЕ ПАЦИЕНТА НАДО ЭКРАНИРОВАТЬ. В документ уходит текст,
// который врач вставлял из чужих систем, — там встречаются и угловые скобки, и
// кавычки. Неэкранированный текст не только ломает вёрстку: файл открывают в
// браузере, и вставленный тег выполнится.

import { describe, it, expect } from "vitest";

await import("../../modules/diagnostics/index.js"); // регистрация модальностей
const { renderCaseDocument } = await import(
  "../../modules/diagnostics/core/services/export.service.js"
);

function makeCase(overrides = {}) {
  return {
    case: {
      _id: "6a67488975db8d0142710079",
      title: "МРТ головного мозга",
      question: "Что за образование?",
      clinicalContext: "Женщина 48 лет.\n\nЖалобы на головную боль.",
      doctorSummary: "Направлена к нейрохирургу.",
      patient: { label: "Пациент К.", ageYears: 48, sex: "female" },
      createdAt: new Date("2026-07-01T10:00:00Z"),
      closedAt: new Date("2026-07-02T10:00:00Z"),
      ...overrides.case,
    },
    artifacts: overrides.artifacts ?? [
      { kind: "report", modality: "mri", text: "Объёмное образование 12 мм." },
    ],
    findings: overrides.findings ?? [
      {
        _id: "1",
        title: "Нужен контраст",
        detail: "Характер накопления из описания не следует.",
        severity: "important",
        confidence: "moderate",
        modality: "mri",
        verdict: "partly",
        correction: "Контраст уже выполнен.",
        recommendations: ["МРТ с контрастом"],
      },
    ],
    jobs: overrides.jobs ?? [
      { provenance: { model: "claude-opus-5", promptVersion: "diag-2026-07-27" } },
    ],
  };
}

describe("порядок и содержание документа", () => {
  const { html } = renderCaseDocument(makeCase());

  it("вывод врача стоит ПЕРЕД разбором ИИ", () => {
    expect(html.indexOf("Вывод врача")).toBeLessThan(html.indexOf("Разбор ·"));
  });

  it("оговорка стоит и в начале, и в подвале", () => {
    const first = html.indexOf("не диагноз");
    const last = html.lastIndexOf("не диагноз");
    expect(first).toBeGreaterThan(-1);
    expect(last).toBeGreaterThan(first);
  });

  it("у каждого вывода напечатан вердикт врача", () => {
    expect(html).toContain("врач согласен частично");
  });

  it("вывод, с которым врач не согласился, из документа не вычищается", () => {
    const { html: h } = renderCaseDocument(
      makeCase({
        findings: [
          {
            _id: "2",
            title: "Спорный вывод",
            detail: "детали",
            severity: "note",
            confidence: "low",
            modality: "mri",
            verdict: "disagree",
          },
        ],
      }),
    );
    // Вычищать несогласованное значило бы подделывать историю разбора.
    expect(h).toContain("Спорный вывод");
    expect(h).toContain("врач не согласен");
  });

  it("поправка врача печатается рядом с выводом", () => {
    expect(html).toContain("Поправка врача");
    expect(html).toContain("Контраст уже выполнен.");
  });

  it("происхождение указано: чем именно получен разбор", () => {
    expect(html).toContain("claude-opus-5");
    expect(html).toContain("diag-2026-07-27");
  });

  it("лабораторная панель печатается таблицей, а не строкой", () => {
    const { html: h } = renderCaseDocument(
      makeCase({
        artifacts: [
          {
            kind: "lab_panel",
            structured: {
              items: [{ name: "Гемоглобин", value: 88, unit: "г/л", refLow: 130, refHigh: 170 }],
            },
          },
        ],
      }),
    );
    expect(h).toContain("<table");
    expect(h).toContain("Гемоглобин");
    expect(h).toContain("130–170");
  });

  it("незакрытое дело честно говорит, что вывода врача нет", () => {
    const { html: h } = renderCaseDocument(makeCase({ case: { doctorSummary: "" } }));
    expect(h).toMatch(/Вывод врача не записан/i);
  });

  it("абзацы и переносы строк сохраняются", () => {
    expect(html).toContain("<p>Женщина 48 лет.</p>");
  });
});

describe("разметка в тексте не выполняется", () => {
  const dangerous = '<script>alert("x")</script> и <b>жирный</b>';

  it("текст врача экранируется", () => {
    const { html } = renderCaseDocument(makeCase({ case: { doctorSummary: dangerous } }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("текст материала экранируется", () => {
    const { html } = renderCaseDocument(
      makeCase({ artifacts: [{ kind: "report", text: dangerous }] }),
    );
    expect(html).not.toContain("<script>");
  });

  it("заголовок и вывод разбора экранируются", () => {
    const { html } = renderCaseDocument(
      makeCase({
        case: { title: dangerous },
        findings: [
          {
            _id: "3",
            title: dangerous,
            detail: dangerous,
            severity: "note",
            confidence: "low",
            modality: "mri",
            verdict: "pending",
          },
        ],
      }),
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>жирный</b>");
  });
});

describe("имя файла", () => {
  it("содержит дату и хвост идентификатора, а не ФИО пациента", () => {
    const { fileName } = renderCaseDocument(makeCase());
    expect(fileName).toMatch(/^razbor-\w{6}-\d{4}-\d{2}-\d{2}\.html$/);
    expect(fileName).not.toMatch(/Пациент/i);
  });
});
