// __tests__/diagnostics/documentReader.test.js
//
// Распознавание документа: что отсекается ДО отправки в модель.
//
// Проверяются именно предварительные отказы, а не качество распознавания.
// Причина простая: отказ, случившийся после отправки, стоит денег и времени
// врача, а отказ до отправки — бесплатный. Всё, что можно понять по самому
// файлу (формат, размер, число страниц), обязано выясняться здесь.
//
// Отдельно проверяется, что распознанное не превращается в вывод молча:
// перечень нечитаемых мест обязан доезжать до врача. Пропущенная цифра, о
// которой он не знает, опаснее отсутствия распознавания: перепроверять он
// станет только то, о чём предупредили.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PDFDocument } from "pdf-lib";

const runJson = vi.fn();
vi.mock("../../modules/diagnostics/ai/runner.js", () => ({
  runJson: (...args) => runJson(...args),
  PROMPT_VERSION: "test-prompt",
  EFFORT: { analysis: "high", extraction: "medium" },
  str: (v, max) => String(v ?? "").trim().slice(0, max),
  list: (arr, max, itemMax) =>
    (Array.isArray(arr) ? arr : [])
      .map((s) => String(s ?? "").trim().slice(0, itemMax))
      .filter(Boolean)
      .slice(0, max),
}));

const { readDocument, assertReadable, ALLOWED_MIME, MAX_FILE_BYTES, MAX_PDF_PAGES } =
  await import("../../modules/diagnostics/ai/documentReader.js");
const { EFFORT } = await import("../../modules/diagnostics/ai/runner.js");
const { ValidationError } = await import("../../common/utils/errors.js");

async function makePdf(pages) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([300, 300]);
  return Buffer.from(await doc.save());
}

const okReply = {
  parsed: {
    text: "Гемоглобин 88 г/л (норма 130–170)",
    docKind: "lab_form",
    unreadable: ["дата в шапке смазана"],
    hasPatientIdentity: true,
  },
  model: "claude-opus-5",
  usage: {},
};

beforeEach(() => {
  runJson.mockReset();
  runJson.mockResolvedValue(okReply);
});

describe("что отсекается до отправки в модель", () => {
  it("неизвестный формат — отказ, а не попытка", async () => {
    await expect(
      assertReadable({ buffer: Buffer.from("x"), mimeType: "video/mp4" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(runJson).not.toHaveBeenCalled();
  });

  it("в отказе перечислено, что принимается", async () => {
    await expect(
      assertReadable({ buffer: Buffer.from("x"), mimeType: "application/zip" }),
    ).rejects.toThrow(/JPEG.*PNG.*PDF/i);
  });

  it("пустой файл", async () => {
    await expect(
      assertReadable({ buffer: Buffer.alloc(0), mimeType: "image/png" }),
    ).rejects.toThrow(/пуст/i);
  });

  it("слишком большой файл — с подсказкой, что делать", async () => {
    const big = Buffer.alloc(MAX_FILE_BYTES + 1);
    await expect(assertReadable({ buffer: big, mimeType: "image/jpeg" })).rejects.toThrow(
      /МБ/,
    );
  });

  it("PDF в пределах лимита страниц проходит", async () => {
    const pdf = await makePdf(3);
    await expect(
      assertReadable({ buffer: pdf, mimeType: "application/pdf" }),
    ).resolves.toEqual({ pages: 3 });
  });

  it("PDF сверх лимита — отказ с числом страниц", async () => {
    const pdf = await makePdf(MAX_PDF_PAGES + 1);
    await expect(assertReadable({ buffer: pdf, mimeType: "application/pdf" })).rejects.toThrow(
      new RegExp(String(MAX_PDF_PAGES + 1)),
    );
  });

  it("битый PDF — понятная ошибка, а не падение", async () => {
    await expect(
      assertReadable({ buffer: Buffer.from("не pdf вовсе"), mimeType: "application/pdf" }),
    ).rejects.toThrow(/повреждён|паролем/i);
  });

  it("все заявленные форматы действительно принимаются", async () => {
    for (const mime of ALLOWED_MIME.filter((m) => m !== "application/pdf")) {
      await expect(
        assertReadable({ buffer: Buffer.from("данные"), mimeType: mime }),
      ).resolves.toEqual({ pages: 1 });
    }
  });
});

describe("запрос к модели", () => {
  it("картинка уходит блоком image, PDF — блоком document", async () => {
    await readDocument({ buffer: Buffer.from("картинка"), mimeType: "image/png" });
    expect(runJson.mock.calls[0][0].content[0].type).toBe("image");

    runJson.mockClear();
    await readDocument({ buffer: await makePdf(1), mimeType: "application/pdf" });
    expect(runJson.mock.calls[0][0].content[0].type).toBe("document");
  });

  it("промпт запрещает толковать и додумывать — это не диагностика", async () => {
    await readDocument({ buffer: Buffer.from("x"), mimeType: "image/jpeg" });
    const { system } = runJson.mock.calls[0][0];
    expect(system).toMatch(/нельзя/i);
    expect(system).toMatch(/диагноз/i);
    expect(system).toMatch(/дополнять|подставлять/i);
  });

  it("распознавание идёт на пониженном уровне усилий", async () => {
    // Переписать напечатанное — не рассуждение. Проверено живым запросом на
    // плотном бланке: на "medium" точность та же, что на "high" (12 из 12
    // значений), поэтому платить за верхний уровень здесь не за что.
    await readDocument({ buffer: Buffer.from("x"), mimeType: "image/png" });
    expect(runJson.mock.calls[0][0].effort).toBe(EFFORT.extraction);
    expect(EFFORT.extraction).not.toBe(EFFORT.analysis);
  });

  it("потолок ответа с запасом: мышление делит бюджет с текстом", async () => {
    // На двадцатистраничном бланке тесный потолок обрывает распознавание на
    // середине, и врач получает часть анализов без предупреждения.
    await readDocument({ buffer: Buffer.from("x"), mimeType: "image/png" });
    expect(runJson.mock.calls[0][0].maxTokens).toBeGreaterThanOrEqual(32000);
  });

  it("подсказка врача доезжает до модели", async () => {
    await readDocument({
      buffer: Buffer.from("x"),
      mimeType: "image/jpeg",
      hint: "второй лист биохимии",
    });
    const textBlock = runJson.mock.calls[0][0].content[1].text;
    expect(textBlock).toContain("второй лист биохимии");
  });
});

describe("результат", () => {
  it("нечитаемые места доезжают до врача", async () => {
    const out = await readDocument({ buffer: Buffer.from("x"), mimeType: "image/png" });
    expect(out.unreadable).toEqual(["дата в шапке смазана"]);
  });

  it("отмечается, что на документе видны данные пациента", async () => {
    const out = await readDocument({ buffer: Buffer.from("x"), mimeType: "image/png" });
    expect(out.hasPatientIdentity).toBe(true);
  });

  it("записывается модель, которая ответила, и версия промпта", async () => {
    const out = await readDocument({ buffer: Buffer.from("x"), mimeType: "image/png" });
    expect(out.model).toBe("claude-opus-5");
    expect(out.promptVersion).toBe("test-prompt");
  });

  it("мусор в ответе не ломает разбор", async () => {
    runJson.mockResolvedValue({ parsed: { text: null, unreadable: "не массив" }, model: "m" });
    const out = await readDocument({ buffer: Buffer.from("x"), mimeType: "image/png" });
    expect(out.text).toBe("");
    expect(out.unreadable).toEqual([]);
    expect(out.docKind).toBe("other");
  });
});
