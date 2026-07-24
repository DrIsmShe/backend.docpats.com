// __tests__/education/fileTypes.test.js
//
// Определение типа файла и приведение к тексту.
//
// Главное, что здесь проверяется, — устойчивость к вранью браузера про
// MIME-тип и к windows-1251, в которой приходит половина русских
// методичек.

import { describe, it, expect } from "vitest";
import {
  resolveFileKind,
  isSupportedFile,
  FILE_KINDS,
} from "../../modules/education/education-ingest/extractors/fileTypes.js";
import {
  decodeText,
  fileToText,
} from "../../modules/education/education-ingest/extractors/fileToText.js";
import iconv from "iconv-lite";

describe("resolveFileKind", () => {
  it("узнаёт PDF и картинки", () => {
    expect(
      resolveFileKind({ mimeType: "application/pdf", fileName: "t.pdf" }).kind,
    ).toBe(FILE_KINDS.PDF);
    expect(
      resolveFileKind({ mimeType: "image/png", fileName: "scan.png" }).kind,
    ).toBe(FILE_KINDS.IMAGE);
  });

  it("правит image/jpg на image/jpeg — API знает только второе", () => {
    const { mediaType } = resolveFileKind({
      mimeType: "image/jpg",
      fileName: "scan.jpg",
    });
    expect(mediaType).toBe("image/jpeg");
  });

  it("определяет тип по расширению, когда браузер прислал octet-stream", () => {
    expect(
      resolveFileKind({
        mimeType: "application/octet-stream",
        fileName: "тесты.docx",
      }).kind,
    ).toBe(FILE_KINDS.DOCX);

    expect(
      resolveFileKind({ mimeType: "", fileName: "вопросы.txt" }).kind,
    ).toBe(FILE_KINDS.TEXT);
  });

  it("принимает старый .doc, в том числе как octet-stream", () => {
    // Браузер отдаёт .doc то как application/msword, то как octet-stream —
    // оба должны опознаваться как бинарный Word.
    expect(
      resolveFileKind({ mimeType: "application/msword", fileName: "t.doc" })
        .kind,
    ).toBe(FILE_KINDS.DOC);
    expect(
      resolveFileKind({
        mimeType: "application/octet-stream",
        fileName: "тесты.doc",
      }).kind,
    ).toBe(FILE_KINDS.DOC);
  });

  it("принимает .csv, который Windows отдаёт как Excel", () => {
    // Классика: application/vnd.ms-excel у обычного текстового CSV.
    expect(
      resolveFileKind({
        mimeType: "application/vnd.ms-excel",
        fileName: "bank.csv",
      }).kind,
    ).toBe(FILE_KINDS.TEXT);
  });

  it("отказывает по расширению даже при правдоподобном MIME", () => {
    // .xlsx имеет валидный MIME, но читать его мы не умеем — попытка
    // разобрать бинарник как текст дала бы мусор вместо вопросов.
    expect(() =>
      resolveFileKind({
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        fileName: "bank.xlsx",
      }),
    ).toThrow(/Сохраните лист как CSV/i);
  });

  it("на отказ даёт конкретный совет, а не общий отлуп", () => {
    expect(() => resolveFileKind({ fileName: "лекция.pptx" })).toThrow(
      /Экспортируйте презентацию в PDF/i,
    );
    expect(() => resolveFileKind({ fileName: "архив.zip" })).toThrow(
      /Распакуйте/i,
    );
  });

  it("незнакомый формат отвергает со списком поддерживаемых", () => {
    expect(() =>
      resolveFileKind({ mimeType: "application/x-msdownload", fileName: "a.exe" }),
    ).toThrow(/Поддерживаются PDF/i);
  });

  it("isSupportedFile не бросает исключений", () => {
    expect(isSupportedFile({ fileName: "a.pdf" })).toBe(true);
    expect(isSupportedFile({ fileName: "a.exe" })).toBe(false);
    expect(isSupportedFile({})).toBe(false);
  });
});

describe("decodeText", () => {
  const RUSSIAN = "УКАЖИТЕ, ЧТО ПРИДАЕТ КОСТЯМ УПРУГОСТЬ";

  it("читает UTF-8", () => {
    expect(decodeText(Buffer.from(RUSSIAN, "utf8"))).toBe(RUSSIAN);
  });

  it("читает UTF-8 с BOM, не оставляя его в тексте", () => {
    const withBom = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(RUSSIAN, "utf8"),
    ]);
    expect(decodeText(withBom)).toBe(RUSSIAN);
  });

  it("распознаёт windows-1251 — иначе русские методички превращаются в мусор", () => {
    const cp1251 = iconv.encode(RUSSIAN, "win1251");
    expect(decodeText(cp1251)).toBe(RUSSIAN);
  });

  it("читает UTF-16 LE с BOM", () => {
    const utf16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      iconv.encode(RUSSIAN, "utf16-le"),
    ]);
    expect(decodeText(utf16)).toBe(RUSSIAN);
  });

  it("пустой буфер даёт пустую строку", () => {
    expect(decodeText(Buffer.alloc(0))).toBe("");
  });
});

describe("fileToText", () => {
  it("переносит обычный текст как есть", async () => {
    const text = "1. Вопрос\nа) первый\nб) второй";
    const result = await fileToText(Buffer.from(text, "utf8"), {
      kind: FILE_KINDS.TEXT,
      fileName: "t.txt",
    });
    expect(result).toBe(text);
  });

  it("снимает HTML-разметку, сохраняя разбиение на строки", async () => {
    const html =
      "<html><body><p>1. Вопрос</p><p>а) первый</p><p>б) второй</p></body></html>";
    const result = await fileToText(Buffer.from(html, "utf8"), {
      kind: FILE_KINDS.TEXT,
      fileName: "t.html",
    });
    expect(result).toContain("1. Вопрос");
    expect(result).toContain("а) первый");
    expect(result).not.toContain("<p>");
    // Варианты не должны склеиться в одну строку.
    expect(result.split("\n").length).toBeGreaterThan(1);
  });

  it("снимает разметку RTF и возвращает кириллицу", async () => {
    // \'d3 — буква «У» в windows-1251, как её пишет Word.
    const rtf = "{\\rtf1\\ansi\\ansicpg1251 \\'d3\\'ea\\'e0\\'e6\\'e8\\'f2\\'e5\\par}";
    const result = await fileToText(Buffer.from(rtf, "binary"), {
      kind: FILE_KINDS.TEXT,
      fileName: "t.rtf",
    });
    expect(result).toContain("Укажите");
    expect(result).not.toContain("\\rtf");
  });

  it("отвергает файл без текста с советом про скан", async () => {
    await expect(
      fileToText(Buffer.from("   \n  ", "utf8"), {
        kind: FILE_KINDS.TEXT,
        fileName: "empty.txt",
      }),
    ).rejects.toThrow(/не удалось извлечь текст/i);
  });

  it("отвергает слишком длинный текст с советом разбить файл", async () => {
    const huge = "а".repeat(400_001);
    await expect(
      fileToText(Buffer.from(huge, "utf8"), {
        kind: FILE_KINDS.TEXT,
        fileName: "big.txt",
      }),
    ).rejects.toThrow(/слишком много текста/i);
  });
});
