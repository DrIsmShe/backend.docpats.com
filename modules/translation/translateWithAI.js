// server/modules/translation/translateWithAI.js
//
// Перевод статьи моделью. Не путать с переводом кейсов арены
// (modules/radiology/translation/caseTranslator.js) — там свой конвейер на
// Claude, здесь OpenAI, и общего у них ничего нет.
//
// ФОРМАТ ОТВЕТА ГАРАНТИРОВАН СХЕМОЙ, а не просьбой в промпте. Раньше модель
// просили «Return ONLY valid JSON» словами, ответ чистили от ```-заборов,
// парсили, а при провале — латали регуляркой, экранирующей переносы строк
// внутри строковых значений. На длинной медицинской статье это регулярно
// разваливалось: в логах жило «❌ Chunk translation failed: Translation JSON
// parse error». Structured outputs снимают весь класс: невалидного JSON
// модель физически не вернёт, и чинить нечего.
//
// СБОЙ БОЛЬШЕ НЕ ВЫГЛЯДИТ УСПЕХОМ. Прежний catch возвращал ИСХОДНЫЙ текст —
// то есть воркер получал «перевод», сохранял его как готовый, и статья
// оставалась на языке оригинала без единой пометки. Узнать об этом можно было
// только глазами или из логов; очередь считала работу сделанной и не
// повторяла её. Теперь ошибка идёт наверх: у задания attempts: 3 с
// экспоненциальной паузой (translation.service.js), а окончательно упавшее
// остаётся в failed-очереди (removeOnFail: false) — видимым.

import OpenAI from "openai";
import { splitTextIntoChunks } from "../../common/utils/chunkText.js";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = process.env.TRANSLATION_MODEL || "gpt-4o-mini";

// Потолок ответа. Ставим явно: перевод должен целиком поместиться в ответ, а
// обрыв по длине — это невалидный JSON, а не «немного короче».
const MAX_TOKENS = 16000;

// Размер куска исходника. Меньше потолка ответа с запасом: перевод обычно
// длиннее оригинала, особенно на азербайджанском и турецком.
const CHUNK_CHARS = 4000;

// Схема ответа. strict: true заставляет модель вернуть ровно эти три поля
// строками — ни объекта в abstract (модель любила складывать туда
// background/objective/methods), ни лишних ключей.
const RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "translation",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "abstract", "content"],
      properties: {
        title: { type: "string", description: "Переведённый заголовок." },
        abstract: {
          type: "string",
          description: "Переведённая аннотация одной строкой, без структуры.",
        },
        content: { type: "string", description: "Переведённый текст целиком." },
      },
    },
  },
};

// -------- utils --------

const normalizeField = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    return Object.values(value).filter(Boolean).join(" ");
  }
  return String(value);
};

// -------- ONE CHUNK --------

const translateSingle = async ({
  title,
  content,
  abstract = "",
  fromLanguage,
  toLanguage,
}) => {
  const response = await client.chat.completions.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature: 0.2,
    response_format: RESPONSE_FORMAT,
    messages: [
      {
        role: "system",
        content:
          "You translate medical content. Keep terminology precise, do not shorten, " +
          "do not summarize, do not add commentary. Translate every field you are given; " +
          "leave a field empty only if it was empty in the source.",
      },
      {
        role: "user",
        content: `Translate from ${fromLanguage} to ${toLanguage}.

TITLE:
${title}

ABSTRACT:
${abstract}

CONTENT:
${content}`,
      },
    ],
  });

  const choice = response.choices?.[0];

  // Обрыв по длине даёт синтаксически битый ответ даже при strict-схеме.
  // Отличаем его от прочих сбоев: лечится он не повтором, а меньшим куском.
  if (choice?.finish_reason === "length") {
    throw new Error(
      `Ответ модели оборвался на пределе длины (${MAX_TOKENS} токенов) — уменьшите CHUNK_CHARS`,
    );
  }
  if (choice?.message?.refusal) {
    throw new Error(`Модель отклонила перевод: ${choice.message.refusal}`);
  }

  const text = choice?.message?.content?.trim() || "";
  if (!text) throw new Error("Модель вернула пустой ответ");

  try {
    return JSON.parse(text);
  } catch {
    // При strict-схеме сюда попасть почти нельзя, но если попали — печатаем
    // достаточно, чтобы понять причину. Прежние 200 символов обрывались
    // раньше места поломки, и разобрать по логу было нечего.
    throw new Error(
      `Модель вернула невалидный JSON вопреки схеме: ${text.slice(0, 2000)}`,
    );
  }
};

// -------- CHUNKS (parallel) --------

const translateChunks = async ({ chunks, fromLanguage, toLanguage }) => {
  const results = await Promise.all(
    chunks.map((chunk) =>
      translateSingle({
        title: "",
        content: chunk,
        abstract: "",
        fromLanguage,
        toLanguage,
      }),
    ),
  );

  return results.map((r) => r.content).join("\n\n");
};

// -------- MAIN --------

export const translateWithAI = async ({
  title,
  content,
  abstract = "",
  fromLanguage,
  toLanguage,
}) => {
  const chunks = splitTextIntoChunks(content, CHUNK_CHARS);

  if (chunks.length === 1) {
    const result = await translateSingle({
      title,
      content,
      abstract,
      fromLanguage,
      toLanguage,
    });

    return {
      title: normalizeField(result.title),
      abstract: normalizeField(result.abstract),
      content: normalizeField(result.content),
    };
  }

  // Заголовок и аннотация переводятся отдельным коротким вызовом: гнать ради
  // них весь текст статьи ещё раз — лишние токены, а склеивать их из первого
  // куска нельзя, куски переводятся без заголовка намеренно.
  const [translatedContent, meta] = await Promise.all([
    translateChunks({ chunks, fromLanguage, toLanguage }),
    translateSingle({
      title,
      abstract,
      content: chunks[0].slice(0, 500),
      fromLanguage,
      toLanguage,
    }),
  ]);

  return {
    title: normalizeField(meta.title),
    abstract: normalizeField(meta.abstract),
    content: translatedContent,
  };
};
