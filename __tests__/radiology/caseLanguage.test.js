// __tests__/radiology/caseLanguage.test.js
//
// Язык врача доходит до кейса САМ, без кнопки «перевести».
//
// Дефект, который здесь закрыт, был невидимым с двух сторон. Язык брался из
// Accept-Language, то есть из локали операционной системы: врач переключал
// интерфейс на турецкий, а заголовок продолжал говорить "ru". Кейс приходил
// русским, и это выглядело как «перевода нет», хотя перевод лежал в базе.
// Второй половиной дефекта был каталог: даже когда перевод был, список кейсов
// отдавал русские названия, потому что перевод накладывался только внутри
// попытки.

import { describe, it, expect, beforeEach, vi } from "vitest";
import RadiologyCase from "../../modules/radiology/radiology-cases/models/radiologyCase.model.js";
import { langOf, DEFAULT_LANG } from "../../modules/radiology/translation/requestLang.js";
import {
  translatedCaseFor,
  translateCaseList,
} from "../../modules/radiology/translation/translatedCase.js";
import { listCases, getCaseForLearner } from "../../modules/radiology/radiology-cases/services/case.service.js";

vi.mock("../../modules/radiology/translation/caseTranslator.js", () => ({
  PROMPT_VERSION: "test",
  MODEL: "test-model",
  translateCaseContent: vi.fn(),
}));

const { translateCaseContent } = await import(
  "../../modules/radiology/translation/caseTranslator.js"
);
const { translateCase } = await import(
  "../../modules/radiology/translation/translateCase.service.js"
);

async function makeCase(overrides = {}) {
  return RadiologyCase.create({
    modality: "cxr",
    title: "Одышка у мужчины 45 лет",
    clinicalContext: "Внезапная одышка после кашля.",
    difficulty: "medium",
    images: [{ url: "https://example.test/1.jpg", order: 0, label: "Прямая проекция" }],
    findings: [
      {
        key: "ptx",
        imageIndex: 0,
        label: "pneumothorax",
        significance: "major",
        geometry: { shape: "rect", coords: { x: 1, y: 1, w: 10, h: 10 } },
        explanation: "Виден край лёгкого без лёгочного рисунка латеральнее.",
      },
    ],
    impression: {
      correctText: "Правосторонний пневмоторакс среднего объёма.",
      diagnosisKeys: ["пневмоторакс"],
      diagnosisSynonyms: ["pneumothorax"],
    },
    source: { kind: "original" },
    status: "published",
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  translateCaseContent.mockImplementation(async ({ targetLang, fields }) => ({
    fields: Object.fromEntries(
      Object.entries(fields).map(([p, t]) => [p, `[${targetLang}] ${t}`]),
    ),
    diagnosisKeys: [`${targetLang}-dx`],
    diagnosisSynonyms: [],
    model: "test-model",
    promptVersion: "test",
  }));
});

describe("язык запроса", () => {
  it("X-Language важнее Accept-Language: интерфейс переключают, локаль системы нет", () => {
    // Ровно тот случай, из-за которого перевод считали неработающим: русская
    // система, турецкий интерфейс.
    const lang = langOf({
      headers: { "x-language": "tr", "accept-language": "ru-RU,ru;q=0.9" },
    });
    expect(lang).toBe("tr");
  });

  it("без X-Language берёт первый ПОДДЕРЖИВАЕМЫЙ язык из Accept-Language", () => {
    // Прежний разбор брал первые два символа строки, то есть "de", и сводил
    // такой запрос к русскому — хотя английский в списке есть.
    expect(langOf({ headers: { "accept-language": "de-DE,en;q=0.9,ru;q=0.8" } })).toBe("en");
  });

  it("регистр и территория не мешают", () => {
    expect(langOf({ headers: { "x-language": "AZ-Latn" } })).toBe("az");
  });

  it("неизвестный язык и отсутствие заголовков сводятся к языку оригинала", () => {
    expect(langOf({ headers: { "x-language": "zz" } })).toBe(DEFAULT_LANG);
    expect(langOf({ headers: {} })).toBe(DEFAULT_LANG);
    expect(langOf({})).toBe(DEFAULT_LANG);
    expect(langOf(undefined)).toBe(DEFAULT_LANG);
  });
});

describe("перевод по требованию при открытии кейса", () => {
  it("кейса без перевода: врач получает свой язык, а не русский текст", async () => {
    const doc = await makeCase();

    const view = await getCaseForLearner(doc._id, { lang: "tr" });

    expect(view.title).toBe("[tr] Одышка у мужчины 45 лет");
    expect(translateCaseContent).toHaveBeenCalledTimes(1);
  });

  it("второе открытие берёт перевод из базы и модель не зовёт", async () => {
    const doc = await makeCase();
    await getCaseForLearner(doc._id, { lang: "tr" });
    translateCaseContent.mockClear();

    const view = await getCaseForLearner(doc._id, { lang: "tr" });

    expect(view.title).toBe("[tr] Одышка у мужчины 45 лет");
    expect(translateCaseContent).not.toHaveBeenCalled();
  });

  it("одновременные открытия одного кейса переводят его ОДИН раз", async () => {
    // Утром смену открывают десятки врачей и попадают на один свежий кейс.
    // Без single-flight это десять оплаченных переводов одного текста.
    const doc = await makeCase();

    const views = await Promise.all(
      Array.from({ length: 5 }, () => getCaseForLearner(doc._id, { lang: "az" })),
    );

    expect(translateCaseContent).toHaveBeenCalledTimes(1);
    for (const view of views) {
      expect(view.title).toBe("[az] Одышка у мужчины 45 лет");
    }
  });

  it("отказ модели не ломает открытие кейса — врач видит оригинал", async () => {
    const doc = await makeCase();
    translateCaseContent.mockRejectedValue(new Error("model declined"));

    const view = await getCaseForLearner(doc._id, { lang: "tr" });

    expect(view.title).toBe("Одышка у мужчины 45 лет");
  });

  it("на путях оценки перевод по требованию не запускается", async () => {
    // Врач уже ответил по тому тексту, который видел; ждать модель на кнопке
    // «сдать» ему не за что.
    const doc = await makeCase();

    const view = await translatedCaseFor("radiology", doc.toObject(), "tr");

    expect(view.title).toBe("Одышка у мужчины 45 лет");
    expect(translateCaseContent).not.toHaveBeenCalled();
  });
});

describe("каталог на языке врача", () => {
  it("список отдаёт переведённые названия", async () => {
    const doc = await makeCase();
    await translateCase("radiology", doc._id, { langs: ["tr"] });

    const page = await listCases({ filters: { skip: 0, limit: 10 }, isEditor: false, lang: "tr" });

    expect(page.items.find((i) => String(i._id) === String(doc._id)).title).toBe(
      "[tr] Одышка у мужчины 45 лет",
    );
  });

  it("редактору список приходит в оригинале: он правит именно этот текст", async () => {
    const doc = await makeCase();
    await translateCase("radiology", doc._id, { langs: ["tr"] });

    const page = await listCases({
      filters: { skip: 0, limit: 10, scope: "all" },
      isEditor: true,
      lang: null,
    });

    expect(page.items.find((i) => String(i._id) === String(doc._id)).title).toBe(
      "Одышка у мужчины 45 лет",
    );
  });

  it("список НЕ запускает перевод: 24 кейса на странице — это не 24 вызова модели", async () => {
    await makeCase();
    await makeCase({ title: "Второй кейс" });
    translateCaseContent.mockClear();

    const page = await listCases({ filters: { skip: 0, limit: 10 }, isEditor: false, lang: "tr" });

    expect(page.items.length).toBe(2);
    expect(translateCaseContent).not.toHaveBeenCalled();
    // Перевода нет — значит в списке остаётся оригинал, а не пустое название.
    expect(page.items[0].title).toBeTruthy();
  });

  it("одна выборка на страницу, а не запрос на кейс", async () => {
    const a = await makeCase();
    const b = await makeCase({ title: "Второй кейс" });
    await translateCase("radiology", a._id, { langs: ["tr"] });
    await translateCase("radiology", b._id, { langs: ["tr"] });

    const items = await translateCaseList(
      "radiology",
      [a.toObject(), b.toObject()],
      "tr",
    );

    expect(items.map((i) => i.title)).toEqual([
      "[tr] Одышка у мужчины 45 лет",
      "[tr] Второй кейс",
    ]);
  });
});
