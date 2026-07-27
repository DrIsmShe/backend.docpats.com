// __tests__/diagnostics/modalities.test.js
//
// Проверка самих подмодулей-модальностей.
//
// Это защита от тихой деградации содержания: подмодуль легко добавить пустым
// («ЭКГ — скоро»), и он будет выглядеть работающим. Здесь закреплено, что у
// каждого есть протокол разбора, красные флаги и настоящий анализатор.
//
// Отдельно проверяется ЧЕСТНОСТЬ: если подмодуль принимает изображения, но не
// умеет их читать, он обязан объяснить это словами (imageNote). Молчаливое
// «принял файл и сделал вид, что посмотрел» — худшее, что можно сделать в
// медицинском интерфейсе.

import { describe, it, expect } from "vitest";

await import("../../modules/diagnostics/index.js");

const { describeModalities, getModality, listModalities, supportsImages } = await import(
  "../../modules/diagnostics/core/services/registry.js"
);
const { listAnalyzerKeys } = await import("../../modules/diagnostics/ai/analyzers.js");
const { MODALITY_KEYS, ARTIFACT_KINDS } = await import(
  "../../modules/diagnostics/constants.js"
);

describe("состав модуля", () => {
  it("зарегистрированы все объявленные модальности", () => {
    expect(listModalities().map((m) => m.key)).toEqual(MODALITY_KEYS);
  });

  it("каждая ссылается на существующий анализатор", () => {
    const known = listAnalyzerKeys();
    for (const m of listModalities()) {
      expect(known, `модальность ${m.key}`).toContain(m.analyzer);
    }
  });

  it("незарегистрированная модальность возвращает null, а не падает", () => {
    expect(getModality("нет такой")).toBeNull();
  });
});

describe("содержание подмодуля", () => {
  const modalities = listModalities();

  it.each(modalities.map((m) => [m.key, m]))(
    "%s: есть протокол, красные флаги и понятное назначение",
    (key, m) => {
      expect(m.title.length).toBeGreaterThan(2);
      expect(m.purpose.length).toBeGreaterThan(10);
      // Протокол — не для галочки: короче четырёх пунктов это не протокол.
      expect(m.checklist.length, `${key}: чек-лист`).toBeGreaterThanOrEqual(4);
      expect(m.redFlags.length, `${key}: красные флаги`).toBeGreaterThanOrEqual(3);
      expect(m.accepts.length).toBeGreaterThan(0);
    },
  );

  it.each(modalities.map((m) => [m.key, m]))(
    "%s: принимает только известные виды материалов",
    (key, m) => {
      for (const kind of m.accepts) expect(ARTIFACT_KINDS).toContain(kind);
    },
  );

  it.each(modalities.map((m) => [m.key, m]))(
    "%s: принимает файл, но не читает его — объясняет это честно",
    (key, m) => {
      // Любой материал, который машина не разбирает: снимок, DICOM, видео,
      // PDF, аудио. Врач должен узнать об этом ДО отправки, а не после.
      const binaryKinds = ["image", "dicom", "video", "document", "audio"];
      const takesBinary = m.accepts.some((k) => binaryKinds.includes(k));
      if (takesBinary && !m.capabilities.includes("image")) {
        expect(m.binaryNote, `${key} обязан объяснить, что будет с файлом`).toBeTruthy();
        expect(m.binaryNote.length).toBeGreaterThan(30);
      }
    },
  );

  it("ни один подмодуль пока не заявляет разбор изображений", () => {
    // Заявить его можно только вместе с моделью и стендом оценки — этот тест
    // сломается ровно тогда, когда кто-то поставит флаг, не сделав остального.
    expect(listModalities().filter((m) => supportsImages(m.key))).toEqual([]);
  });
});

describe("описание для интерфейса", () => {
  it("отдаёт протокол врачу, а не прячет его", () => {
    const described = describeModalities();
    expect(described).toHaveLength(MODALITY_KEYS.length);
    const labs = described.find((m) => m.key === "labs");
    expect(labs.checklist.length).toBeGreaterThan(0);
    expect(labs.redFlags.length).toBeGreaterThan(0);
  });

  it("порядок стабилен — интерфейс не должен прыгать между запросами", () => {
    expect(describeModalities().map((m) => m.key)).toEqual(
      describeModalities().map((m) => m.key),
    );
  });
});
