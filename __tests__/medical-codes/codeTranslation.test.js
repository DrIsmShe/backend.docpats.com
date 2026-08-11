// __tests__/medical-codes/codeTranslation.test.js
//
// Перевод названий кодов. Вызов модели замокан: тест проверяет ЛОГИКУ вокруг
// него — разбор ответа, отказ при рассинхроне, сохранение и то, что поиск
// после перевода начинает находить по переведённому названию.
//
// Самое важное здесь — проверка на сдвиг: если модель вернёт на один перевод
// меньше, названия разъедутся по кодам, и гастрит получит имя синусита. Такую
// пачку нужно отбрасывать целиком, а не записывать частично.

import { describe, it, expect, beforeEach, vi } from "vitest";

const createMock = vi.fn();

// Мокаем клиента Anthropic на уровне модуля-хелпера, который использует сервис.
vi.mock(
  "../../modules/education/education-ingest/extractors/claude.extractor.js",
  () => ({
    getClient: () => ({ messages: { create: createMock } }),
    isConfigured: () => true,
    describeApiError: (err) => ({ retryable: false, message: err?.message }),
  }),
);

const { default: MedicalCode, CODE_SYSTEMS, normalizeCode, buildSearchText } =
  await import("../../modules/medicalCodes/models/medicalCode.model.js");
const { translateBatch, countUntranslated, nextUntranslatedBatch } =
  await import("../../modules/medicalCodes/services/codeTranslation.service.js");
const { searchCodes, resetSearchStrategy } = await import(
  "../../modules/medicalCodes/services/codeSearch.service.js"
);

function reply(text) {
  return { stop_reason: "end_turn", content: [{ type: "text", text }] };
}

async function seed() {
  const rows = [
    { code: "A00.0", en: "Cholera due to Vibrio cholerae" },
    { code: "A00.9", en: "Cholera, unspecified" },
    { code: "J35.01", en: "Chronic tonsillitis" },
  ];

  await MedicalCode.insertMany(
    rows.map(({ code, en }) => {
      const doc = {
        system: CODE_SYSTEMS.ICD10CM,
        code,
        codeNormalized: normalizeCode(code),
        titles: { en, ru: "", az: "", tr: "", ar: "" },
        parentCode: code.split(".")[0],
        isBillable: true,
      };
      return { ...doc, searchText: buildSearchText(doc) };
    }),
  );
}

describe("перевод кодов", () => {
  beforeEach(async () => {
    createMock.mockReset();
    resetSearchStrategy();
    await seed();
  });

  it("сохраняет переводы и обновляет строку поиска", async () => {
    createMock.mockResolvedValue(
      reply('["Холера, вызванная холерным вибрионом","Холера неуточнённая"]'),
    );

    const batch = await nextUntranslatedBatch("ru", { limit: 2 });
    const count = await translateBatch(batch, "ru");

    expect(count).toBe(2);

    const doc = await MedicalCode.findOne({ code: "A00.9" }).lean();
    expect(doc.titles.ru).toBe("Холера неуточнённая");
    // Переведённое название обязано попасть в searchText, иначе запасной
    // поиск по обычному Mongo не найдёт код по-русски.
    expect(doc.searchText).toContain("Холера неуточнённая");
  });

  it("после перевода код находится по русскому названию", async () => {
    createMock.mockResolvedValue(reply('["Хронический тонзиллит"]'));

    const batch = await MedicalCode.find({ code: "J35.01" })
      .select("_id code titles")
      .lean();
    await translateBatch(batch, "ru");

    const { items } = await searchCodes({ query: "тонзиллит", locale: "ru" });
    expect(items.map((i) => i.code)).toContain("J35.01");
  });

  it("отбрасывает пачку целиком, если переводов пришло меньше", async () => {
    // Сдвиг на один элемент — самая опасная ошибка: названия разъедутся по
    // кодам молча.
    createMock.mockResolvedValue(reply('["Только один перевод"]'));

    const batch = await nextUntranslatedBatch("ru", { limit: 3 });
    await expect(translateBatch(batch, "ru")).rejects.toThrow(/вместо/);

    const untouched = await MedicalCode.findOne({ code: "A00.0" }).lean();
    expect(untouched.titles.ru).toBe("");
  });

  it("разбирает ответ, обёрнутый в markdown", async () => {
    createMock.mockResolvedValue(
      reply('```json\n["Холера А","Холера Б"]\n```'),
    );

    const batch = await nextUntranslatedBatch("ru", { limit: 2 });
    expect(await translateBatch(batch, "ru")).toBe(2);
  });

  it("отказ модели не записывает ничего", async () => {
    createMock.mockResolvedValue({ stop_reason: "refusal", content: [] });

    const batch = await nextUntranslatedBatch("ru", { limit: 2 });
    await expect(translateBatch(batch, "ru")).rejects.toThrow(/отказал/i);

    const doc = await MedicalCode.findOne({ code: "A00.0" }).lean();
    expect(doc.titles.ru).toBe("");
  });

  it("пустой перевод пропускается, английское название сохраняется", async () => {
    createMock.mockResolvedValue(reply('["","Холера неуточнённая"]'));

    const batch = await nextUntranslatedBatch("ru", { limit: 2 });
    const count = await translateBatch(batch, "ru");

    expect(count).toBe(1);
    const skipped = await MedicalCode.findOne({ code: "A00.0" }).lean();
    expect(skipped.titles.ru).toBe("");
    expect(skipped.titles.en).toBeTruthy();
  });

  it("не переводит на английский — это язык оригинала", async () => {
    const batch = await nextUntranslatedBatch("ru", { limit: 1 });
    await expect(translateBatch(batch, "en")).rejects.toThrow(/язык/i);
  });

  it("считает непереведённые коды по языкам отдельно", async () => {
    createMock.mockResolvedValue(reply('["Хронический тонзиллит"]'));

    const batch = await MedicalCode.find({ code: "J35.01" })
      .select("_id code titles")
      .lean();
    await translateBatch(batch, "ru");

    expect(await countUntranslated("ru")).toBe(2);
    expect(await countUntranslated("az")).toBe(3);
  });
});
