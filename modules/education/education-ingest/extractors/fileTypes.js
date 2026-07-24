// server/modules/education/education-ingest/extractors/fileTypes.js
//
// Определение того, ЧТО за файл нам дали и как его читать.
//
// Anthropic API принимает напрямую только три вещи: PDF, изображения и
// текст. Всё остальное нужно превратить в текст на нашей стороне — либо
// мы умеем это делать, либо честно отказываемся с объяснением.
//
// Почему нельзя опираться только на MIME-тип из браузера: он врёт.
// Windows отдаёт .csv как application/vnd.ms-excel, .md часто приходит с
// пустым типом, а файл, перетащенный из архива, — как
// application/octet-stream. Поэтому тип определяется по MIME, а если тот
// бесполезен — по расширению имени файла.

import path from "node:path";
import { ValidationError } from "../../../../common/utils/errors.js";

// Как читать файл. Не то же самое, что формат: и .txt, и .csv, и .html
// сводятся к одному способу — «прочитать как текст».
export const FILE_KINDS = {
  PDF: "pdf", // уходит в API как document-блок
  IMAGE: "image", // уходит в API как image-блок
  TEXT: "text", // читаем сами, отдаём модели текстом
  DOCX: "docx", // конвертируем в текст через mammoth
  DOC: "doc", // старый бинарный Word (OLE2) — через word-extractor
};

// Изображения перечислены явно: media_type уходит в API как есть,
// и произвольный тип там не пройдёт.
const IMAGE_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

const MIME_TO_KIND = {
  "application/pdf": FILE_KINDS.PDF,
  "application/x-pdf": FILE_KINDS.PDF,

  "image/jpeg": FILE_KINDS.IMAGE,
  "image/jpg": FILE_KINDS.IMAGE,
  "image/png": FILE_KINDS.IMAGE,
  "image/webp": FILE_KINDS.IMAGE,
  "image/gif": FILE_KINDS.IMAGE,

  "text/plain": FILE_KINDS.TEXT,
  "text/markdown": FILE_KINDS.TEXT,
  "text/x-markdown": FILE_KINDS.TEXT,
  "text/csv": FILE_KINDS.TEXT,
  "text/tab-separated-values": FILE_KINDS.TEXT,
  "text/html": FILE_KINDS.TEXT,
  "text/rtf": FILE_KINDS.TEXT,
  "application/rtf": FILE_KINDS.TEXT,
  "application/json": FILE_KINDS.TEXT,
  "application/xml": FILE_KINDS.TEXT,
  "text/xml": FILE_KINDS.TEXT,

  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    FILE_KINDS.DOCX,

  // Старый бинарный Word. Браузер обычно отдаёт application/msword, но
  // нередко и application/octet-stream — тогда тип ловится по расширению.
  "application/msword": FILE_KINDS.DOC,
  "application/vnd.ms-word": FILE_KINDS.DOC,
};

const EXT_TO_KIND = {
  ".pdf": FILE_KINDS.PDF,

  ".jpg": FILE_KINDS.IMAGE,
  ".jpeg": FILE_KINDS.IMAGE,
  ".png": FILE_KINDS.IMAGE,
  ".webp": FILE_KINDS.IMAGE,
  ".gif": FILE_KINDS.IMAGE,

  ".txt": FILE_KINDS.TEXT,
  ".text": FILE_KINDS.TEXT,
  ".md": FILE_KINDS.TEXT,
  ".markdown": FILE_KINDS.TEXT,
  ".csv": FILE_KINDS.TEXT,
  ".tsv": FILE_KINDS.TEXT,
  ".html": FILE_KINDS.TEXT,
  ".htm": FILE_KINDS.TEXT,
  ".rtf": FILE_KINDS.TEXT,
  ".json": FILE_KINDS.TEXT,
  ".xml": FILE_KINDS.TEXT,

  ".docx": FILE_KINDS.DOCX,
  ".doc": FILE_KINDS.DOC,
};

// Форматы, которые мы осознанно НЕ поддерживаем. Отказ с конкретным
// советом полезнее, чем «неподдерживаемый тип файла»: в девяти случаях из
// десяти пересохранить файл — минутное дело.
const UNSUPPORTED_HINTS = {
  ".xls":
    "Excel не читается напрямую. Сохраните лист как CSV (Файл → Сохранить как → CSV) и загрузите его.",
  ".xlsx":
    "Excel не читается напрямую. Сохраните лист как CSV (Файл → Сохранить как → CSV) и загрузите его.",
  ".ppt":
    "PowerPoint не читается напрямую. Экспортируйте презентацию в PDF и загрузите его.",
  ".pptx":
    "PowerPoint не читается напрямую. Экспортируйте презентацию в PDF и загрузите его.",
  ".odt":
    "Формат OpenDocument не читается. Сохраните файл как .docx или PDF.",
  ".ods": "Формат OpenDocument не читается. Сохраните лист как CSV.",
  ".pages": "Формат Pages не читается. Экспортируйте файл в PDF или .docx.",
  ".zip":
    "Архив загрузить нельзя. Распакуйте его и загрузите файлы по одному.",
  ".rar": "Архив загрузить нельзя. Распакуйте его и загрузите файлы по одному.",
  ".7z": "Архив загрузить нельзя. Распакуйте его и загрузите файлы по одному.",
  ".djvu": "Формат DjVu не читается. Сконвертируйте файл в PDF.",
  ".epub": "Формат EPUB не читается. Сконвертируйте файл в PDF.",
  ".tif": "Формат TIFF не поддерживается. Сохраните изображение как PNG или JPG.",
  ".tiff":
    "Формат TIFF не поддерживается. Сохраните изображение как PNG или JPG.",
  ".bmp": "Формат BMP не поддерживается. Сохраните изображение как PNG или JPG.",
  ".heic":
    "Формат HEIC не поддерживается. Сохраните изображение как JPG или PNG.",
};

function extensionOf(fileName) {
  return path.extname(String(fileName ?? "")).toLowerCase();
}

/**
 * Определяет, как читать файл.
 *
 * @param {object} args
 * @param {string} [args.mimeType]  тип от браузера — может врать или отсутствовать
 * @param {string} [args.fileName]  имя файла; по нему определяем тип, если MIME бесполезен
 * @returns {{ kind: string, mediaType: string|null }}
 * @throws {ValidationError} если формат заведомо не читается
 */
export function resolveFileKind({ mimeType, fileName } = {}) {
  const mime = String(mimeType ?? "")
    .toLowerCase()
    .split(";")[0]
    .trim();
  const ext = extensionOf(fileName);

  // 1. Явный отказ по расширению — приоритетнее всего: .xlsx приходит с
  //    вполне «валидным» MIME, но читать мы его не умеем, и молчаливая
  //    попытка разобрать его как текст дала бы мусор вместо вопросов.
  if (UNSUPPORTED_HINTS[ext]) {
    throw new ValidationError(UNSUPPORTED_HINTS[ext]);
  }

  // 2. По MIME-типу.
  const byMime = MIME_TO_KIND[mime];
  if (byMime) {
    return {
      kind: byMime,
      mediaType: byMime === FILE_KINDS.IMAGE ? normalizeImageType(mime) : null,
    };
  }

  // 3. По расширению — когда браузер прислал octet-stream или пустоту.
  const byExt = EXT_TO_KIND[ext];
  if (byExt) {
    return {
      kind: byExt,
      mediaType:
        byExt === FILE_KINDS.IMAGE ? normalizeImageType(`image/${ext.slice(1)}`) : null,
    };
  }

  // 4. Текстовый MIME, которого нет в таблице (text/whatever) — читаем как текст.
  if (mime.startsWith("text/")) {
    return { kind: FILE_KINDS.TEXT, mediaType: null };
  }

  throw new ValidationError(
    `Формат файла не распознан${ext ? ` (${ext})` : ""}. ` +
      "Поддерживаются PDF, изображения (JPG, PNG, WebP, GIF), Word (.doc, .docx) " +
      "и текстовые файлы (TXT, MD, CSV, HTML, RTF). " +
      "Файл другого формата пересохраните в PDF.",
  );
}

// image/jpg — распространённое, но неверное написание; API ждёт image/jpeg.
function normalizeImageType(mime) {
  const normalized = mime === "image/jpg" ? "image/jpeg" : mime;
  return IMAGE_MEDIA_TYPES.includes(normalized) ? normalized : "image/png";
}

/** Список расширений для атрибута accept в форме загрузки. */
export function acceptedExtensions() {
  return Object.keys(EXT_TO_KIND).sort();
}

/** Читается ли такой файл вообще — без выброса исключения. */
export function isSupportedFile({ mimeType, fileName } = {}) {
  try {
    resolveFileKind({ mimeType, fileName });
    return true;
  } catch {
    return false;
  }
}
