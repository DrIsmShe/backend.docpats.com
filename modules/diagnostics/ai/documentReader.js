// server/modules/diagnostics/ai/documentReader.js
//
// РАСПОЗНАВАНИЕ ДОКУМЕНТА: фото бланка, скан выписки, PDF заключения → текст.
//
// Это НЕ диагностика по изображению. Разница принципиальная, и её стоит
// удерживать в голове при любой правке этого файла:
//
//   распознавание — перенести напечатанное в текст. Проверяемо: врач видит
//     исходник и результат рядом и сверяет их за секунды;
//   интерпретация — сказать, что на снимке патология. Непроверяемо на глаз, и
//     цена ошибки другая.
//
// Здесь только первое. Поэтому системный промпт запрещает трактовать,
// дополнять и «исправлять» прочитанное: единственная задача — переписать.
//
// ФАЙЛ НЕ СОХРАНЯЕТСЯ. Ни на диск, ни в R2, ни в базу. Он живёт в памяти
// процесса на время запроса, в дело попадает только текст — и только после
// того, как врач его проверил и нажал «Добавить». Причина: существующая
// загрузка кладёт файлы в публичный бакет с открытой ссылкой, а фотография
// бланка — это ФИО, дата рождения и номер карты. Хранилище, которого нет,
// невозможно скомпрометировать.
//
// НЕРАЗОБРАННОЕ ВАЖНЕЕ РАЗОБРАННОГО. Модель обязана перечислить, что не
// прочиталось: смазанную цифру, обрезанный край, рукописную пометку. Молча
// пропущенная цифра в анализе опаснее, чем отсутствие распознавания вообще:
// врач не станет перепроверять то, о чём не знает.

import { PDFDocument } from "pdf-lib";

import { PROMPT_VERSION, runJson, str, list } from "./runner.js";
import { ValidationError } from "../../../common/utils/errors.js";

/** Что принимаем. Список закрытый: неизвестный формат — отказ, а не попытка. */
export const ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
];

// 12 МБ — фотография бланка с телефона укладывается с запасом, а случайно
// выбранное видео отсекается до того, как уедет в модель.
export const MAX_FILE_BYTES = 12 * 1024 * 1024;

// Страницы PDF тарифицируются каждая. Двадцати хватает на выписку; на попытку
// загрузить историю болезни целиком отвечаем понятным отказом, а не счётом.
export const MAX_PDF_PAGES = 20;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["text", "unreadable", "docKind"],
  properties: {
    text: {
      type: "string",
      description:
        "Всё напечатанное и написанное, переписанное как есть, с сохранением структуры строк и таблиц. Ничего не добавлять и не толковать.",
    },
    docKind: {
      type: "string",
      enum: ["lab_form", "report", "discharge", "referral", "prescription", "other"],
      description: "Что это за документ, судя по форме бланка",
    },
    unreadable: {
      type: "array",
      items: { type: "string" },
      description:
        "Что НЕ удалось прочитать: смазанные цифры, обрезанные края, неразборчивый почерк. Каждый пункт — с указанием места. Пустой массив, если прочиталось всё.",
    },
    hasPatientIdentity: {
      type: "boolean",
      description:
        "Видны ли на документе ФИО, дата рождения, номер карты или телефон пациента",
    },
  },
};

const SYSTEM = [
  "Ты переписываешь содержимое медицинского документа в текст.",
  "",
  "Твоя единственная задача — ТОЧНО перенести напечатанное. Категорически нельзя:",
  "— толковать результаты, ставить диагноз, делать выводы;",
  "— дополнять пропущенное «по смыслу», подставлять привычные референсы;",
  "— исправлять то, что кажется опечаткой: врач должен увидеть документ как есть;",
  "— угадывать плохо различимые цифры. Неразличимое помечай [?] в тексте",
  "  и обязательно перечисляй в unreadable.",
  "",
  "Числа, единицы измерения и референсные интервалы переноси дословно —",
  "именно по ним потом считает программа, и ошибка в одной цифре меняет вывод.",
  "Структуру таблиц сохраняй построчно: показатель, значение, единица, норма.",
  "Пиши на языке оригинала документа.",
].join("\n");

/** Сколько страниц в PDF. Ошибку разбора считаем повреждённым файлом. */
async function countPdfPages(buffer) {
  try {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    return doc.getPageCount();
  } catch {
    throw new ValidationError(
      "Не удалось открыть PDF — файл повреждён или защищён паролем",
    );
  }
}

/**
 * Проверки до отправки. Отдельной функцией, чтобы контроллер мог отказать
 * быстро и понятно, не тратя запрос к модели.
 */
export async function assertReadable({ buffer, mimeType }) {
  if (!buffer?.length) throw new ValidationError("Файл пуст");
  if (!ALLOWED_MIME.includes(mimeType)) {
    throw new ValidationError(
      `Формат ${mimeType || "не определён"} не поддерживается. Принимаются JPEG, PNG, WebP и PDF`,
    );
  }
  if (buffer.length > MAX_FILE_BYTES) {
    const mb = (buffer.length / 1024 / 1024).toFixed(1);
    throw new ValidationError(
      `Файл ${mb} МБ — больше допустимых ${MAX_FILE_BYTES / 1024 / 1024} МБ. Сфотографируйте бланк отдельно от остальных страниц`,
    );
  }
  if (mimeType === "application/pdf") {
    const pages = await countPdfPages(buffer);
    if (pages > MAX_PDF_PAGES) {
      throw new ValidationError(
        `В PDF ${pages} страниц, принимается не больше ${MAX_PDF_PAGES}. Выделите нужные страницы отдельным файлом`,
      );
    }
    return { pages };
  }
  return { pages: 1 };
}

/**
 * Распознать документ.
 *
 * @param {object} a
 * @param {Buffer} a.buffer
 * @param {string} a.mimeType
 * @param {string} [a.hint] — подсказка врача, что это за документ
 * @returns {Promise<{text: string, docKind: string, unreadable: string[],
 *   hasPatientIdentity: boolean, model: string, promptVersion: string, pages: number}>}
 */
export async function readDocument({ buffer, mimeType, hint = "" }) {
  const { pages } = await assertReadable({ buffer, mimeType });

  const data = buffer.toString("base64");
  const fileBlock =
    mimeType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: mimeType, data } };

  const instruction = [
    hint ? `Врач уточняет, что это: ${str(hint, 300)}` : null,
    "Перепиши содержимое документа. Не толкуй и не дополняй.",
  ]
    .filter(Boolean)
    .join("\n");

  const { parsed, model } = await runJson({
    system: SYSTEM,
    schema: SCHEMA,
    what: "документ",
    maxTokens: 16000,
    content: [fileBlock, { type: "text", text: instruction }],
  });

  return {
    text: str(parsed.text, 60000),
    docKind: parsed.docKind ?? "other",
    unreadable: list(parsed.unreadable, 20, 300),
    hasPatientIdentity: Boolean(parsed.hasPatientIdentity),
    model,
    promptVersion: PROMPT_VERSION,
    pages,
  };
}
