// __tests__/education/chunker.test.js
//
// Нарезка исходника на части под проход модели. Проверяем то, ради чего
// нарезчик и написан: большой файл распадается на несколько частей, каждая
// строится в отдельный буфер, и плотную часть можно поделить пополам.

import { describe, it, expect, vi } from "vitest";
import { PDFDocument } from "pdf-lib";

// Для .doc нарезчик зовёт fileToText → word-extractor, которому нужен
// настоящий бинарный OLE-файл. Синтезировать его в тесте нечем, а суть
// проверки не в извлечении (оно покрыто в fileTypes.test), а в
// МАРШРУТИЗАЦИИ: .doc обязан резаться как текст, а не идти одним куском.
// Поэтому подменяем fileToText готовым текстом.
vi.mock(
  "../../modules/education/education-ingest/extractors/fileToText.js",
  async (importOriginal) => {
    const actual = await importOriginal();
    return {
      ...actual,
      fileToText: vi.fn(async (buffer) => buffer.toString("utf8")),
    };
  },
);

import { planChunks } from "../../modules/education/education-ingest/extractors/chunker.js";
import { FILE_KINDS } from "../../modules/education/education-ingest/extractors/fileTypes.js";

async function makePdf(pages) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) {
    const page = doc.addPage([300, 400]);
    // Латиница: стандартный шрифт pdf-lib не кодирует кириллицу, а тексту
    // на странице для нарезки по страницам всё равно.
    page.drawText(`Question on page ${i + 1}`, { x: 20, y: 360, size: 12 });
  }
  return Buffer.from(await doc.save());
}

describe("planChunks — PDF", () => {
  it("режет по 20 страниц: 45 страниц → 3 части", async () => {
    const bytes = await makePdf(45);
    const { chunks, unit, size } = await planChunks({
      bytes,
      kind: FILE_KINDS.PDF,
      mimeType: "application/pdf",
      fileName: "big.pdf",
    });
    expect(unit).toBe("pages");
    expect(size).toBe(45);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].label).toBe("стр. 1–20");
    expect(chunks[2].label).toBe("стр. 41–45");
  });

  it("каждая часть строится в валидный PDF нужного размера", async () => {
    const bytes = await makePdf(25);
    const { chunks } = await planChunks({
      bytes,
      kind: FILE_KINDS.PDF,
      mimeType: "application/pdf",
      fileName: "big.pdf",
    });
    const built = await chunks[0].build();
    expect(built.mimeType).toBe("application/pdf");
    const reparsed = await PDFDocument.load(built.buffer);
    expect(reparsed.getPageCount()).toBe(20);
  });

  it("плотную часть делит пополам", async () => {
    const bytes = await makePdf(20);
    const { chunks } = await planChunks({
      bytes,
      kind: FILE_KINDS.PDF,
      mimeType: "application/pdf",
      fileName: "big.pdf",
    });
    const halves = chunks[0].subdivide();
    expect(halves).toHaveLength(2);
    const a = await halves[0].build();
    const b = await halves[1].build();
    expect((await PDFDocument.load(a.buffer)).getPageCount()).toBe(10);
    expect((await PDFDocument.load(b.buffer)).getPageCount()).toBe(10);
  });

  it("одностраничную часть делить дальше нельзя", async () => {
    const bytes = await makePdf(1);
    const { chunks } = await planChunks({
      bytes,
      kind: FILE_KINDS.PDF,
      mimeType: "application/pdf",
      fileName: "one.pdf",
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].subdivide()).toBeNull();
  });
});

describe("planChunks — текст", () => {
  it("большой текст режет на несколько частей по границе абзацев", async () => {
    // Абзац ~500 символов × 200 = 100k символов, при лимите 40k → ≥3 части.
    const para = "Вопрос. " + "клинический разбор ".repeat(25);
    const text = Array.from({ length: 200 }, () => para).join("\n\n");
    const bytes = Buffer.from(text, "utf8");

    const { chunks, unit } = await planChunks({
      bytes,
      kind: FILE_KINDS.TEXT,
      mimeType: "text/plain",
      fileName: "big.txt",
    });
    expect(unit).toBe("chars");
    expect(chunks.length).toBeGreaterThanOrEqual(3);

    const built = await chunks[0].build();
    expect(built.mimeType).toBe("text/plain");
    // Лимит в символах, а не байтах: токены коррелируют с символами, а
    // кириллица в UTF-8 занимает по 2 байта. Ни один кусок не выходит за
    // лимит по символам (границы по абзацам их не разрывают).
    for (const c of chunks) {
      const b = await c.build();
      expect(b.buffer.toString("utf8").length).toBeLessThanOrEqual(40_000);
    }
  });

  it("короткий текст — одна часть", async () => {
    const bytes = Buffer.from("Один короткий вопрос?", "utf8");
    const { chunks } = await planChunks({
      bytes,
      kind: FILE_KINDS.TEXT,
      mimeType: "text/plain",
      fileName: "small.txt",
    });
    expect(chunks).toHaveLength(1);
  });

  // Регрессия: большой .doc уходил одним куском (unit "whole") и падал на
  // переполнении лимита вывода, потому что .doc не был в текстовой ветке
  // нарезчика. Должен резаться наравне с .docx и текстом.
  it("большой .doc режется по частям, а не идёт одним куском", async () => {
    const para = "Вопрос. " + "клинический разбор ".repeat(25);
    const text = Array.from({ length: 200 }, () => para).join("\n\n");
    const bytes = Buffer.from(text, "utf8");

    const { chunks, unit } = await planChunks({
      bytes,
      kind: FILE_KINDS.DOC,
      mimeType: "application/msword",
      fileName: "big.doc",
    });
    expect(unit).toBe("chars"); // не "whole"
    expect(chunks.length).toBeGreaterThanOrEqual(3);
  });
});

describe("planChunks — картинка", () => {
  it("скан не режется: одна часть, делить нельзя", async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]); // JPEG-заголовок
    const { chunks, unit } = await planChunks({
      bytes,
      kind: FILE_KINDS.IMAGE,
      mimeType: "image/jpeg",
      fileName: "scan.jpg",
    });
    expect(unit).toBe("whole");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].subdivide()).toBeNull();
    const built = await chunks[0].build();
    expect(built.mimeType).toBe("image/jpeg");
  });
});
