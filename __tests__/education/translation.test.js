// __tests__/education/translation.test.js
//
// Автоперевод вопросов на остальные языки программы.
//
// Проверяется прежде всего то, что тихо ломает экзамен и не видно на глаз:
// перевод, изменивший верный ответ, и перевод, затёрший ручную правку.
// Ошибка в тексте заметна сразу; ошибка в ключах — только по тому, что вопрос
// вдруг начинают заваливать все.
//
// Модель здесь замокана: тест проверяет логику раскладки и решения «трогать /
// не трогать», а не качество перевода. Качество проверяется живым прогоном.

import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import ExamItem from "../../modules/education/education-items/models/examItem.model.js";
import ExamProgram from "../../modules/education/education-catalog/models/examProgram.model.js";

// Мок ставится ДО импорта сервиса: он берёт translateItemContent на этапе
// загрузки модуля.
vi.mock("../../modules/education/education-translation/translator.js", () => ({
  PROMPT_VERSION: "test",
  MODEL: "test-model",
  translateItemContent: vi.fn(),
}));

const { translateItemContent } = await import(
  "../../modules/education/education-translation/translator.js"
);
const { translateItem, listTranslations, updateTranslation } = await import(
  "../../modules/education/education-translation/translateItem.service.js"
);
const { recountPublishedItems } = await import(
  "../../modules/education/education-catalog/services/program.service.js"
);

const oid = () => new mongoose.Types.ObjectId();

/** Переводчик, который честно возвращает те же ключи с префиксом языка. */
function goodTranslator() {
  translateItemContent.mockImplementation(async ({ item, targetLang }) => ({
    stem: `[${targetLang}] ${item.stem}`,
    options: item.options.map((o) => ({ key: o.key, text: `[${targetLang}] ${o.text}` })),
    explanation: `[${targetLang}] ${item.explanation}`,
    model: "test-model",
    promptVersion: "test",
  }));
}

async function makeProgram() {
  return ExamProgram.create({
    code: "tr-test",
    title: "Программа",
    country: "SA",
    region: "mena",
    examType: "licensing",
    passingScorePercent: 60,
    defaultQuestionCount: 4,
    blueprint: [{ code: "cardio", title: "Кардиология", weightPercent: 100 }],
    status: "published",
  });
}

async function makeItem(programId, overrides = {}) {
  return ExamItem.create({
    programId,
    topicCode: "cardio",
    lang: "ru",
    stem: "У пациента 60 лет боль за грудиной. Что делать?",
    options: [
      { key: "A", text: "ЭКГ немедленно" },
      { key: "B", text: "Наблюдение" },
      { key: "C", text: "Выписать домой" },
    ],
    correctKeys: ["A"],
    explanation: "ЭКГ — первый шаг.",
    source: { kind: "original" },
    status: "published",
    reviewedBy: oid(),
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  goodTranslator();
});

describe("translateItem", () => {
  it("создаёт по вопросу на каждый язык, кроме языка оригинала", async () => {
    const program = await makeProgram();
    const item = await makeItem(program._id);

    const report = await translateItem(item._id);

    expect(report.created).toHaveLength(4);
    expect(report.failed).toHaveLength(0);

    const langs = (await ExamItem.find({ translationOf: item._id }).lean())
      .map((d) => d.lang)
      .sort();
    expect(langs).toEqual(["ar", "az", "en", "tr"]);
  });

  it("копирует correctKeys и ключи вариантов дословно — перевод не меняет верный ответ", async () => {
    const program = await makeProgram();
    const item = await makeItem(program._id);

    await translateItem(item._id);

    for (const doc of await ExamItem.find({ translationOf: item._id }).lean()) {
      expect(doc.correctKeys).toEqual(["A"]);
      expect(doc.options.map((o) => o.key)).toEqual(["A", "B", "C"]);
      // Тексты при этом переведены — иначе тест проходил бы и на пустой работе.
      expect(doc.options[0].text).toContain(`[${doc.lang}]`);
    }
  });

  it("сохраняет порядок вариантов, даже если модель их переставила", async () => {
    const program = await makeProgram();
    const item = await makeItem(program._id);

    translateItemContent.mockImplementation(async ({ item: src, targetLang }) => ({
      stem: "перевод",
      // Порядок намеренно обратный.
      options: [...src.options].reverse().map((o) => ({ key: o.key, text: `x-${o.key}` })),
      explanation: "",
      model: "test-model",
      promptVersion: "test",
    }));

    await translateItem(item._id, { langs: ["en"] });

    const doc = await ExamItem.findOne({ translationOf: item._id, lang: "en" }).lean();
    expect(doc.options.map((o) => o.key)).toEqual(["A", "B", "C"]);
  });

  it("не затирает перевод, выправленный человеком", async () => {
    const program = await makeProgram();
    const item = await makeItem(program._id);
    await translateItem(item._id, { langs: ["en"] });

    const translation = await ExamItem.findOne({ translationOf: item._id, lang: "en" });
    await updateTranslation(translation._id, {
      stem: "Выправлено врачом",
      actorId: oid(),
    });

    // Оригинал изменился — перевод устарел, но он проверен человеком.
    await ExamItem.updateOne({ _id: item._id }, { $set: { version: 2 } });
    const report = await translateItem(item._id, { langs: ["en"], force: true });

    expect(report.skipped).toEqual([{ lang: "en", reason: "skip_reviewed" }]);
    const after = await ExamItem.findById(translation._id).lean();
    expect(after.stem).toBe("Выправлено врачом");
  });

  it("не переводит заново то, что уже переведено с текущей версии", async () => {
    const program = await makeProgram();
    const item = await makeItem(program._id);
    await translateItem(item._id, { langs: ["en"] });

    translateItemContent.mockClear();
    const report = await translateItem(item._id, { langs: ["en"] });

    expect(translateItemContent).not.toHaveBeenCalled();
    expect(report.skipped).toEqual([{ lang: "en", reason: "skip_fresh" }]);
  });

  it("обновляет перевод, когда оригинал изменился", async () => {
    const program = await makeProgram();
    const item = await makeItem(program._id);
    await translateItem(item._id, { langs: ["en"] });

    await ExamItem.updateOne(
      { _id: item._id },
      { $set: { version: 2, stem: "Новое условие" } },
    );
    const report = await translateItem(item._id, { langs: ["en"] });

    expect(report.updated).toHaveLength(1);
    const doc = await ExamItem.findOne({ translationOf: item._id, lang: "en" }).lean();
    expect(doc.stem).toContain("Новое условие");
    expect(doc.translationSourceVersion).toBe(2);
  });

  it("отказ модели на одном языке не лишает врача остальных", async () => {
    const program = await makeProgram();
    const item = await makeItem(program._id);

    translateItemContent.mockImplementation(async ({ item: src, targetLang }) => {
      if (targetLang === "ar") throw new Error("модель отказала");
      return {
        stem: "ок",
        options: src.options.map((o) => ({ key: o.key, text: "ок" })),
        explanation: "",
        model: "test-model",
        promptVersion: "test",
      };
    });

    const report = await translateItem(item._id);

    expect(report.created).toHaveLength(3);
    expect(report.failed).toEqual([
      { lang: "ar", message: "модель отказала" },
    ]);
  });

  it("не переводит перевод", async () => {
    const program = await makeProgram();
    const item = await makeItem(program._id);
    await translateItem(item._id, { langs: ["en"] });
    const translation = await ExamItem.findOne({ translationOf: item._id });

    await expect(translateItem(translation._id)).rejects.toThrow(/translate the source/i);
  });
});

describe("updateTranslation", () => {
  it("не позволяет править ключи вариантов — они принадлежат оригиналу", async () => {
    const program = await makeProgram();
    const item = await makeItem(program._id);
    await translateItem(item._id, { langs: ["en"] });
    const translation = await ExamItem.findOne({ translationOf: item._id, lang: "en" });

    await expect(
      updateTranslation(translation._id, {
        options: [{ key: "Z", text: "подмена" }],
        actorId: oid(),
      }),
    ).rejects.toThrow(/Unknown option keys/);
  });
});

describe("витрина программы", () => {
  it("считает вопрос и его переводы как один вопрос, но язык теста — как пять", async () => {
    const program = await makeProgram();
    const item = await makeItem(program._id);
    await translateItem(item._id);

    await recountPublishedItems(program._id);
    const fresh = await ExamProgram.findById(program._id).lean();

    expect(fresh.publishedItemCount).toBe(1);
    expect(fresh.languages.sort()).toEqual(["ar", "az", "en", "ru", "tr"]);
  });
});

describe("listTranslations", () => {
  it("показывает и отсутствующие языки — иначе не видно, чего не хватает", async () => {
    const program = await makeProgram();
    const item = await makeItem(program._id);
    await translateItem(item._id, { langs: ["en"] });

    const state = await listTranslations(item._id);
    const byLang = Object.fromEntries(state.languages.map((l) => [l.lang, l.status]));

    expect(byLang.en).toBe("auto");
    expect(byLang.tr).toBe("missing");
    expect(byLang.ar).toBe("missing");
  });
});
