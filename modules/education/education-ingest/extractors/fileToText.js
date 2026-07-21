// server/modules/education/education-ingest/extractors/fileToText.js
//
// Превращение «не-PDF и не-картинки» в обычный текст, который можно
// отдать модели.
//
// Ключевая деталь для наших материалов — КОДИРОВКА. Русские сборники
// тестов часто приходят в windows-1251: файл, сохранённый в Word 2003 или
// выгруженный из старой АСУ вуза, в UTF-8 не читается и превращается в
// «Ð£ÐšÐÐ–Ð˜Ð¢Ð•». Молча скормить такое модели — значит получить мусор
// вместо вопросов, поэтому кодировка определяется, а не предполагается.

import iconv from "iconv-lite";
import { ValidationError } from "../../../../common/utils/errors.js";
import { FILE_KINDS } from "./fileTypes.js";
import logger from "../../../../common/logger.js";

// Потолок на объём текста. 400 000 символов — это уже сотни страниц:
// столько всё равно не поместится в один проход извлечения, и лучше
// сказать об этом сразу, чем потратить деньги на заведомо обрезанный ответ.
const MAX_TEXT_CHARS = 400_000;

/**
 * Декодирует буфер в строку, определяя кодировку.
 *
 * Порядок проверок:
 *   1. BOM — однозначный признак, доверяем ему без раздумий;
 *   2. UTF-8 — если декодировалось без символов замены, это оно;
 *   3. windows-1251 — самый вероятный вариант для русских файлов.
 */
export function decodeText(buffer) {
  if (!buffer || buffer.length === 0) return "";

  // UTF-8 BOM
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString("utf8");
  }
  // UTF-16 LE / BE BOM
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return iconv.decode(buffer.subarray(2), "utf16-le");
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return iconv.decode(buffer.subarray(2), "utf16-be");
  }

  const asUtf8 = buffer.toString("utf8");
  // U+FFFD — символ замены: появляется там, где байты не сложились в UTF-8.
  const replacements = (asUtf8.match(/�/g) || []).length;

  // Единичный «плохой» символ может быть и в честном UTF-8 (битый байт в
  // середине файла), поэтому смотрим на долю, а не на факт наличия.
  if (replacements === 0 || replacements / asUtf8.length < 0.0005) {
    return asUtf8;
  }

  const asCp1251 = iconv.decode(buffer, "win1251");
  logger?.info?.(
    { replacements, length: buffer.length },
    "text file decoded as windows-1251",
  );
  return asCp1251;
}

// Грубое снятие HTML-разметки. Полноценный парсер здесь избыточен: нам
// нужен только читаемый текст, а не структура документа.
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    // Блочные теги превращаем в переносы строк, иначе вопросы и варианты
    // склеятся в одну строку и модель не разберёт, где кончается вариант.
    .replace(/<\/(p|div|tr|li|h[1-6]|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

// Грубое снятие RTF-разметки. Best-effort: RTF из Word содержит горы
// служебных конструкций, и вычистить их полностью без парсера нельзя.
// Задача скромнее — оставить читаемый текст.
function stripRtf(rtf) {
  return rtf
    .replace(/\{\\\*[\s\S]*?\}/g, " ") // служебные группы целиком
    .replace(/\\'([0-9a-f]{2})/gi, (_, hex) =>
      // \'d3 — байт в кодировке документа; для русских RTF это cp1251.
      iconv.decode(Buffer.from([parseInt(hex, 16)]), "win1251"),
    )
    .replace(/\\par[d]?\b/g, "\n")
    .replace(/\\line\b/g, "\n")
    .replace(/\\tab\b/g, "\t")
    .replace(/\\[a-z]+-?\d*\s?/gi, "") // прочие управляющие слова
    .replace(/[{}]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Приводит файл к тексту.
 *
 * @param {Buffer} buffer
 * @param {object} args
 * @param {string} args.kind      из resolveFileKind
 * @param {string} [args.fileName]
 * @returns {Promise<string>}
 */
export async function fileToText(buffer, { kind, fileName } = {}) {
  let text;

  if (kind === FILE_KINDS.DOCX) {
    // mammoth импортируем лениво: он нужен редко, а тянет за собой
    // заметный объём зависимостей.
    const mammoth = (await import("mammoth")).default;
    const result = await mammoth.extractRawText({ buffer });
    text = result.value ?? "";

    // Сообщения mammoth — это не ошибки, а замечания вида «пропущен
    // объект такого-то типа». Полезны в логах, когда распознавание
    // окажется неполным.
    if (result.messages?.length) {
      logger?.info?.(
        { fileName, messages: result.messages.slice(0, 5) },
        "docx conversion produced warnings",
      );
    }
  } else {
    const decoded = decodeText(buffer);
    const lower = String(fileName ?? "").toLowerCase();

    if (lower.endsWith(".rtf") || decoded.startsWith("{\\rtf")) {
      text = stripRtf(decoded);
    } else if (
      lower.endsWith(".html") ||
      lower.endsWith(".htm") ||
      /^\s*<(!doctype|html)/i.test(decoded)
    ) {
      text = stripHtml(decoded);
    } else {
      text = decoded;
    }
  }

  text = text.replace(/\r\n/g, "\n").trim();

  if (!text) {
    throw new ValidationError(
      "Из файла не удалось извлечь текст. Возможно, это скан — тогда сохраните его как PDF или изображение, " +
        "и распознавание пойдёт по картинке.",
    );
  }

  if (text.length > MAX_TEXT_CHARS) {
    throw new ValidationError(
      `В файле слишком много текста (${Math.round(text.length / 1000)} тыс. символов). ` +
        "Разбейте его на части — за один проход разумно обрабатывать до сотни вопросов.",
    );
  }

  return text;
}
