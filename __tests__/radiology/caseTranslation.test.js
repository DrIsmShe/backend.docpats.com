// __tests__/radiology/caseTranslation.test.js
//
// Перевод учебных кейсов и — главное — оценка ответа на языке врача.
//
// Центральный тест здесь не про текст, а про балл: до этой работы врач,
// читавший кейс по-турецки и написавший верный диагноз по-турецки, получал
// ноль, потому что diagnosisMatcher сверял его строку с русским списком.
// Ошибка была невидимой: кейс выглядел переведённым и работающим.

import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import RadiologyCase from "../../modules/radiology/radiology-cases/models/radiologyCase.model.js";
import ArenaCaseTranslation from "../../modules/radiology/translation/arenaCaseTranslation.model.js";
import { gradeDiagnosis } from "../../modules/radiology/radiology-attempts/services/diagnosisMatcher.js";
import {
  mergeCaseTranslation,
  translatedCaseFor,
} from "../../modules/radiology/translation/translatedCase.js";
import { sourceHashOf, collectCaseFields } from "../../modules/radiology/translation/caseFields.js";

vi.mock("../../modules/radiology/translation/caseTranslator.js", () => ({
  PROMPT_VERSION: "test",
  MODEL: "test-model",
  translateCaseContent: vi.fn(),
}));

const { translateCaseContent } = await import(
  "../../modules/radiology/translation/caseTranslator.js"
);
const { translateCase, listCaseTranslations, updateCaseTranslation } = await import(
  "../../modules/radiology/translation/translateCase.service.js"
);

const oid = () => new mongoose.Types.ObjectId();

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
      diagnosisSynonyms: ["правосторонний пневмоторакс", "pneumothorax"],
    },
    source: { kind: "original" },
    status: "published",
    ...overrides,
  });
}

/** Честный переводчик: помечает прозу языком, диагноз даёт по-турецки. */
function turkishTranslator() {
  translateCaseContent.mockImplementation(async ({ targetLang, fields }) => ({
    fields: Object.fromEntries(
      Object.entries(fields).map(([p, t]) => [p, `[${targetLang}] ${t}`]),
    ),
    diagnosisKeys: targetLang === "tr" ? ["pnömotoraks"] : [`${targetLang}-dx`],
    diagnosisSynonyms: targetLang === "tr" ? ["sağ pnömotoraks"] : [],
    model: "test-model",
    promptVersion: "test",
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  turkishTranslator();
});

describe("оценка диагноза на языке врача", () => {
  it("до перевода турецкий ответ не засчитывался — воспроизводим дефект", async () => {
    const doc = (await makeCase()).toObject();

    const { score } = gradeDiagnosis({
      givenKeys: ["pnömotoraks"],
      givenText: "pnömotoraks",
      acceptedKeys: doc.impression.diagnosisKeys,
      synonyms: doc.impression.diagnosisSynonyms,
    });

    expect(score).toBe(0);
  });

  it("после перевода тот же ответ засчитывается", async () => {
    const doc = await makeCase();
    await translateCase("radiology", doc._id, { langs: ["tr"] });

    const localized = await translatedCaseFor("radiology", doc.toObject(), "tr");
    const { score } = gradeDiagnosis({
      givenKeys: ["pnömotoraks"],
      givenText: "pnömotoraks",
      acceptedKeys: localized.impression.diagnosisKeys,
      synonyms: localized.impression.diagnosisSynonyms,
    });

    expect(score).toBe(1);
  });

  it("русский ответ продолжает засчитываться на турецком кейсе — наборы объединяются, а не заменяются", async () => {
    const doc = await makeCase();
    await translateCase("radiology", doc._id, { langs: ["tr"] });

    const localized = await translatedCaseFor("radiology", doc.toObject(), "tr");
    // Врач читает по-турецки, но пишет латиницей — так тоже принято.
    const { score } = gradeDiagnosis({
      givenKeys: ["pneumothorax"],
      givenText: "pneumothorax",
      acceptedKeys: localized.impression.diagnosisKeys,
      synonyms: localized.impression.diagnosisSynonyms,
    });

    expect(score).toBe(1);
    expect(localized.impression.diagnosisKeys).toContain("пневмоторакс");
    expect(localized.impression.diagnosisKeys).toContain("pnömotoraks");
  });

  it("эталон заключения подменяется переведённым — иначе эвристика сверяет слова разных языков", async () => {
    const doc = await makeCase();
    await translateCase("radiology", doc._id, { langs: ["tr"] });

    const localized = await translatedCaseFor("radiology", doc.toObject(), "tr");
    expect(localized.impression.correctText).toContain("[tr]");
  });
});

describe("наложение перевода", () => {
  it("переводит текст, но не трогает геометрию, ключи находок и изображения", async () => {
    const doc = await makeCase();
    await translateCase("radiology", doc._id, { langs: ["tr"] });
    const localized = await translatedCaseFor("radiology", doc.toObject(), "tr");

    expect(localized.title).toContain("[tr]");
    expect(localized.findings[0].explanation).toContain("[tr]");
    // Ключ находки и её метка — идентификаторы разметки, а не текст.
    expect(localized.findings[0].key).toBe("ptx");
    expect(localized.findings[0].label).toBe("pneumothorax");
    expect(localized.findings[0].geometry.coords).toEqual({ x: 1, y: 1, w: 10, h: 10 });
    expect(localized.images[0].url).toBe("https://example.test/1.jpg");
  });

  it("на языке оригинала возвращает кейс как есть", async () => {
    const doc = await makeCase();
    await translateCase("radiology", doc._id, { langs: ["tr"] });

    const same = await translatedCaseFor("radiology", doc.toObject(), "ru");
    expect(same.title).toBe("Одышка у мужчины 45 лет");
  });

  it("без перевода отдаёт оригинал, а не пустоту", async () => {
    const doc = await makeCase();
    const view = await translatedCaseFor("radiology", doc.toObject(), "ar");
    expect(view.title).toBe("Одышка у мужчины 45 лет");
  });

  it("недостающее поле остаётся на языке оригинала, остальное переводится", async () => {
    const doc = (await makeCase()).toObject();
    const merged = mergeCaseTranslation("radiology", doc, {
      fields: [{ path: "title", text: "Sağ pnömotoraks" }],
      diagnosisKeys: [],
      diagnosisSynonyms: [],
    });

    expect(merged.title).toBe("Sağ pnömotoraks");
    expect(merged.clinicalContext).toBe("Внезапная одышка после кашля.");
  });
});

describe("устаревание", () => {
  it("правка принятых диагнозов делает перевод устаревшим — иначе врач не получит балл за новый синоним", async () => {
    const doc = await makeCase();
    const before = sourceHashOf("radiology", doc.toObject());

    await RadiologyCase.updateOne(
      { _id: doc._id },
      { $push: { "impression.diagnosisSynonyms": "спонтанный пневмоторакс" } },
    );
    const after = sourceHashOf("radiology", (await RadiologyCase.findById(doc._id).lean()));

    expect(after).not.toBe(before);
  });

  it("правка текста кейса помечает перевод устаревшим", async () => {
    const doc = await makeCase();
    await translateCase("radiology", doc._id, { langs: ["tr"] });

    await RadiologyCase.updateOne(
      { _id: doc._id },
      { $set: { clinicalContext: "Другой контекст." } },
    );

    const state = await listCaseTranslations("radiology", doc._id);
    expect(state.languages.find((l) => l.lang === "tr").status).toBe("stale");
  });

  it("не переводит заново то, что не изменилось", async () => {
    const doc = await makeCase();
    await translateCase("radiology", doc._id, { langs: ["tr"] });

    translateCaseContent.mockClear();
    const report = await translateCase("radiology", doc._id, { langs: ["tr"] });

    expect(translateCaseContent).not.toHaveBeenCalled();
    expect(report.skipped).toEqual([{ lang: "tr", reason: "skip_fresh" }]);
  });
});

describe("защита ручной работы", () => {
  it("выправленный перевод не перезаписывается даже принудительно", async () => {
    const doc = await makeCase();
    await translateCase("radiology", doc._id, { langs: ["tr"] });
    await updateCaseTranslation("radiology", doc._id, "tr", {
      fields: { title: "Выправлено врачом" },
      actorId: oid(),
    });

    const report = await translateCase("radiology", doc._id, { langs: ["tr"], force: true });

    expect(report.skipped).toEqual([{ lang: "tr", reason: "skip_reviewed" }]);
    const row = await ArenaCaseTranslation.findOne({ caseId: doc._id, lang: "tr" }).lean();
    expect(row.fields.find((f) => f.path === "title").text).toBe("Выправлено врачом");
  });

  it("нельзя оставить список принятых диагнозов пустым", async () => {
    const doc = await makeCase();
    await translateCase("radiology", doc._id, { langs: ["tr"] });

    await expect(
      updateCaseTranslation("radiology", doc._id, "tr", { diagnosisKeys: [] }),
    ).rejects.toThrow(/не может быть пустым/);
  });
});

describe("состав переводимого", () => {
  it("единицы, референсы и происхождение не переводятся", async () => {
    const doc = (await makeCase()).toObject();
    const fields = collectCaseFields("radiology", doc);
    const paths = Object.keys(fields).join(" ");

    expect(paths).not.toContain("source");
    expect(paths).not.toContain("findings.ptx.label");
    expect(paths).toContain("findings.ptx.explanation");
  });
});

describe("устойчивость", () => {
  it("отказ на одном языке не лишает врача остальных", async () => {
    const doc = await makeCase();
    translateCaseContent.mockImplementation(async ({ targetLang, fields }) => {
      if (targetLang === "ar") throw new Error("модель отказала");
      return {
        fields: Object.fromEntries(Object.keys(fields).map((p) => [p, "ok"])),
        diagnosisKeys: ["dx"],
        diagnosisSynonyms: [],
        model: "test-model",
        promptVersion: "test",
      };
    });

    const report = await translateCase("radiology", doc._id);

    expect(report.created).toHaveLength(3);
    expect(report.failed).toEqual([{ lang: "ar", message: "модель отказала" }]);
  });
});
