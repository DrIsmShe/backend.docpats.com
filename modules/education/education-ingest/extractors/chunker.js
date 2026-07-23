// server/modules/education/education-ingest/extractors/chunker.js
//
// Нарезка исходного файла на части под один проход модели.
//
// Потолок — не размер файла, а ответ модели за раз: MAX_TOKENS ограничивает
// вывод примерно 200–300 вопросами. Сборник на тысячи вопросов одним
// вызовом не пройдёт — обрежется на середине. Поэтому большой документ мы
// режем на части ЗАРАНЕЕ, по объёму, и гоним проходами (см. runExtraction).
//
// Режем консервативно: лучше лишний проход, чем обрыв. Плотность вопросов на
// странице непредсказуема, поэтому если часть всё-таки не поместилась,
// сервис делит её пополам и повторяет — для этого у каждой части есть
// subdivide().
//
// Что режется:
//   PDF   — по страницам (pdf-lib копирует диапазон в новый документ);
//   текст — по символам на границе абзацев (Word/TXT/HTML/RTF уже приведены
//           к тексту в fileToText);
//   картинка — НЕ режется: один скан = один проход. Если вопросов на нём
//           больше лимита, поможет только пересъёмка по частям.

import { PDFDocument } from "pdf-lib";
import { FILE_KINDS } from "./fileTypes.js";
import { fileToText } from "./fileToText.js";

// Консервативные размеры части. 20 плотных страниц MCQ — это ~100–200
// вопросов, заведомо под лимитом вывода. Текст: ~40k символов ≈ столько же.
const PDF_PAGES_PER_CHUNK = 20;
const TEXT_CHARS_PER_CHUNK = 40_000;

// Ниже этого части не делим при subdivide: смысла в проходе по одной
// странице или крошечному куску текста нет.
const MIN_PDF_PAGES = 1;
const MIN_TEXT_CHARS = 4_000;

// ─── PDF ──────────────────────────────────────────────────────────────

function pdfChunk(srcDoc, pageIndices, fileName) {
  return {
    label: `стр. ${pageIndices[0] + 1}–${pageIndices[pageIndices.length - 1] + 1}`,
    async build() {
      const out = await PDFDocument.create();
      const pages = await out.copyPages(srcDoc, pageIndices);
      for (const p of pages) out.addPage(p);
      const bytes = await out.save();
      return {
        buffer: Buffer.from(bytes),
        mimeType: "application/pdf",
        fileName,
      };
    },
    subdivide() {
      if (pageIndices.length <= MIN_PDF_PAGES) return null;
      const mid = Math.ceil(pageIndices.length / 2);
      return [
        pdfChunk(srcDoc, pageIndices.slice(0, mid), fileName),
        pdfChunk(srcDoc, pageIndices.slice(mid), fileName),
      ];
    },
  };
}

async function chunkPdf(bytes, fileName) {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const total = src.getPageCount();
  const chunks = [];
  for (let from = 0; from < total; from += PDF_PAGES_PER_CHUNK) {
    const indices = [];
    for (let i = from; i < Math.min(from + PDF_PAGES_PER_CHUNK, total); i += 1) {
      indices.push(i);
    }
    chunks.push(pdfChunk(src, indices, fileName));
  }
  return { chunks, unit: "pages", size: total };
}

// ─── Текст ────────────────────────────────────────────────────────────
// Режем на границе пустых строк: вопрос обычно отделён пустой строкой, и
// так мы редко разрываем его пополам. Если один абзац сам длиннее лимита —
// отдаём его целиком, дробить внутри вопроса нельзя.

function splitTextByChars(text, limit) {
  const parts = [];
  const paragraphs = text.split(/\n\s*\n/);
  let buf = "";
  for (const para of paragraphs) {
    if (buf && buf.length + para.length + 2 > limit) {
      parts.push(buf);
      buf = "";
    }
    buf = buf ? `${buf}\n\n${para}` : para;
  }
  if (buf) parts.push(buf);
  return parts;
}

function textChunk(text, fileName, label) {
  return {
    label,
    async build() {
      return {
        buffer: Buffer.from(text, "utf8"),
        // Приводим к text/plain: экстрактор возьмёт как готовый текст, а не
        // попытается снова разбирать разметку исходного формата.
        mimeType: "text/plain",
        fileName: fileName ? `${fileName}.txt` : "chunk.txt",
      };
    },
    subdivide() {
      if (text.length <= MIN_TEXT_CHARS) return null;
      const halves = splitTextByChars(text, Math.ceil(text.length / 2));
      if (halves.length < 2) return null;
      return halves.map((h, i) => textChunk(h, fileName, `${label}.${i + 1}`));
    },
  };
}

async function chunkText(bytes, kind, fileName) {
  const text = await fileToText(bytes, { kind, fileName });
  const parts = splitTextByChars(text, TEXT_CHARS_PER_CHUNK);
  const chunks = parts.map((p, i) =>
    textChunk(p, fileName, `часть ${i + 1}`),
  );
  return { chunks, unit: "chars", size: text.length };
}

// ─── Картинка / единый кусок ──────────────────────────────────────────

function wholeChunk(bytes, mimeType, fileName) {
  return {
    label: "весь файл",
    async build() {
      return { buffer: bytes, mimeType, fileName };
    },
    // Скан-картинку не режем: у неё нет ни страниц, ни текста, которые
    // можно раздать по проходам.
    subdivide() {
      return null;
    },
  };
}

/**
 * Делит файл на части под проходы модели.
 *
 * @returns {Promise<{chunks: object[], unit: "pages"|"chars"|"whole", size: number}>}
 *   chunks — по порядку; у каждого build() → {buffer, mimeType, fileName}
 *   и subdivide() → [часть, часть] | null.
 */
export async function planChunks({ bytes, kind, mimeType, fileName }) {
  if (kind === FILE_KINDS.PDF) {
    return chunkPdf(bytes, fileName);
  }
  if (kind === FILE_KINDS.TEXT || kind === FILE_KINDS.DOCX) {
    return chunkText(bytes, kind, fileName);
  }
  // Изображение и всё прочее — одним куском.
  return { chunks: [wholeChunk(bytes, mimeType, fileName)], unit: "whole", size: 1 };
}
