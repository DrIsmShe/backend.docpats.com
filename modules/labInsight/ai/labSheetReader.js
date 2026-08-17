// server/modules/labInsight/ai/labSheetReader.js
// ─────────────────────────────────────────────────────────────────────
//   Фото бланка анализов → перечень показателей.
//
//   ГРАНИЦА, КОТОРУЮ НЕЛЬЗЯ РАЗМЫВАТЬ. Модель здесь делает РОВНО ОДНО:
//   переписывает напечатанное. Что считать нормой, что отклонением и
//   насколько это тревожно — считает программа, арифметикой, из
//   значения и референса, переписанных с того же бланка.
//
//   Почему так, а не «спроси у модели, всё ли в порядке»: суждение
//   «это отклонение» проверяемо на глаз — пациент видит 98 при норме
//   120–160 и понимает, откуда взялся вывод. Суждение, сгенерированное
//   моделью, выглядит так же убедительно и когда оно неверно, а
//   проверить его пациент не может по определению — он для того и
//   пришёл. Арифметика не ошибается уверенно.
//
//   ФАЙЛ НЕ СОХРАНЯЕТСЯ — как и в diagnostics/documentReader: фотография
//   бланка это ФИО, дата рождения и номер карты. Хранилище, которого
//   нет, невозможно скомпрометировать. В базу попадают только
//   показатели, и только если пациент нажал «сохранить».
//
//   НЕПРОЧИТАННОЕ ВАЖНЕЕ ПРОЧИТАННОГО. Молча пропущенная строка бланка
//   опаснее отказа: пациент не станет искать то, о чём не знает.
// ─────────────────────────────────────────────────────────────────────

import { EFFORT, runJson } from "../../diagnostics/ai/runner.js";
import { assertReadable } from "../../diagnostics/ai/documentReader.js";

// Поднимать при КАЖДОМ изменении системного промпта: версия пишется в
// происхождение разбора, и по ней потом видно, каким текстом получен
// вывод полугодовой давности.
export const PROMPT_VERSION = "lab-2026-08-17a";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["parameters", "unreadable", "isLabSheet"],
  properties: {
    isLabSheet: {
      type: "boolean",
      description:
        "Это действительно бланк лабораторных анализов? false для рецепта, выписки, снимка, чека, случайного фото",
    },
    labName: {
      type: "string",
      description: "Название лаборатории, если напечатано. Иначе пустая строка",
    },
    collectedAt: {
      type: "string",
      description:
        "Дата забора материала в виде YYYY-MM-DD, если напечатана. Иначе пустая строка. НЕ подставлять сегодняшнюю",
    },
    parameters: {
      type: "array",
      description: "Каждая строка таблицы показателей, как напечатана",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "rawValue", "unit", "refText"],
        properties: {
          name: {
            type: "string",
            description: "Название показателя дословно с бланка",
          },
          rawValue: {
            type: "string",
            description:
              "Значение дословно, как напечатано, включая знаки < и >. Не округлять, не переводить в другие единицы",
          },
          unit: { type: "string", description: "Единица измерения с бланка" },
          refText: {
            type: "string",
            description:
              "Референсный интервал дословно, как напечатан: «120-160», «до 5.2», «отрицательно». Пустая строка, если на бланке его нет",
          },
        },
      },
    },
    unreadable: {
      type: "array",
      items: { type: "string" },
      description:
        "Что не удалось прочитать: смазанная цифра, обрезанный край, неразборчивая строка. С указанием места. Пустой массив, если прочиталось всё",
    },
  },
};

const SYSTEM = [
  "Ты переписываешь таблицу показателей с бланка лабораторных анализов.",
  "",
  "Единственная задача — ТОЧНО перенести напечатанное. Категорически нельзя:",
  "— толковать результаты, говорить о норме и отклонении, делать выводы;",
  "— подставлять «обычные» референсные интервалы, если на бланке их нет;",
  "— пересчитывать значения в другие единицы;",
  "— исправлять то, что кажется опечаткой;",
  "— угадывать плохо различимые цифры — такие строки перечисляй в unreadable.",
  "",
  "Числа, единицы и референсы переноси дословно: по ним потом считает",
  "программа, и ошибка в одной цифре меняет вывод.",
  "",
  "Если это не бланк анализов, поставь isLabSheet=false и оставь",
  "parameters пустым. Не пытайся вытянуть показатели из рецепта или выписки.",
].join("\n");

/**
 * Прочитать бланк.
 *
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @returns {Promise<{isLabSheet, labName, collectedAt, parameters, unreadable}>}
 */
export async function readLabSheet({ buffer, mimeType }) {
  // Те же проверки, что и у врачебного распознавания: размер, формат,
  // число страниц. Отдельный набор ограничений для пациента означал бы,
  // что одну и ту же фотографию система принимает или отвергает в
  // зависимости от того, кто её прислал.
  await assertReadable({ buffer, mimeType });

  const data = buffer.toString("base64");
  const fileBlock =
    mimeType === "application/pdf"
      ? {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data },
        }
      : { type: "image", source: { type: "base64", media_type: mimeType, data } };

  const { parsed, model } = await runJson({
    system: SYSTEM,
    schema: SCHEMA,
    what: "бланк анализов",
    // Переписать таблицу — механическая работа, а не рассуждение.
    effort: EFFORT.extraction,
    content: [
      fileBlock,
      { type: "text", text: "Перепиши таблицу показателей с этого бланка." },
    ],
  });

  return {
    isLabSheet: parsed.isLabSheet === true,
    labName: String(parsed.labName || "").trim(),
    collectedAt: String(parsed.collectedAt || "").trim(),
    parameters: Array.isArray(parsed.parameters) ? parsed.parameters : [],
    unreadable: Array.isArray(parsed.unreadable) ? parsed.unreadable : [],
    model,
    promptVersion: PROMPT_VERSION,
  };
}

export default { readLabSheet, PROMPT_VERSION };
