// server/modules/translation/translateWithAI.js
//
// Перевод статьи моделью Claude.
//
// ПОЧЕМУ ПЕРЕЕХАЛИ С OpenAI. Переводчик был единственным местом проекта,
// которое ходило в OpenAI: разборы, синтез, арена и консультации давно на
// Claude. Это означало второй счёт, второй ключ и вторую точку отказа — и
// она сработала: 8 сентября 2026 на счету OpenAI кончились деньги, воркер
// начал получать 429 «You have no credits remaining» на каждой задаче, и
// статьи врачей молча остались непереведёнными. В логе это видно, в
// интерфейсе — нет: человек с азербайджанским интерфейсом просто читает
// русский текст.
//
// ФОРМАТ ОТВЕТА ГАРАНТИРОВАН СХЕМОЙ, а не просьбой в промпте. structured
// outputs снимают весь класс ошибок разбора: невалидного JSON модель не
// вернёт, и чинить регуляркой нечего.
//
// СБОЙ НЕ ВЫГЛЯДИТ УСПЕХОМ. Прежний catch возвращал ИСХОДНЫЙ текст — то
// есть воркер получал «перевод», сохранял его как готовый, и статья
// оставалась на языке оригинала без единой пометки. Ошибка идёт наверх: у
// задания attempts: 3 с экспоненциальной паузой (translation.service.js), а
// окончательно упавшее остаётся в failed-очереди видимым.
//
// ОТКАЗ КЛАССИФИКАТОРА — ШТАТНЫЙ ОТВЕТ, А НЕ ОШИБКА. Медицинский текст
// (травма, отравление, токсикология) иногда попадает под ложное
// срабатывание. Для таких случаев включена цепочка запасных моделей: без
// неё статья осталась бы без перевода на один язык из пяти.

import Anthropic from "@anthropic-ai/sdk";
import { splitTextIntoChunks } from "../../../common/utils/chunkText.js";
import { prepareSchema } from "../../../common/utils/structuredOutputSchema.js";
import logger from "../../../common/logger.js";

let клиент = null;

/** Клиент создаётся лениво: ключа может не быть в тестах и при сборке. */
function getClient() {
  if (!клиент) клиент = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return клиент;
}

// Перевод — преобразование готового текста, а не рассуждение с нуля:
// качество держится на точности терминов. Модель и усилие выведены в
// окружение, чтобы менять их без выкладки кода.
// Модель приходит сверху — из общей таблицы назначений
// (common/ai/provider.js), которую видно в админке. Здесь остаётся только
// запасное имя на случай прямого вызова в обход мостика.
export const MODEL_ПО_УМОЛЧАНИЮ = "claude-sonnet-5";
const EFFORT = process.env.TRANSLATION_EFFORT || "medium";

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const FALLBACKS_ENABLED = process.env.TRANSLATION_FALLBACKS !== "0";

/* Поддержку `fallbacks` нельзя определить по имени модели — список решает
   API, и он меняется без нас. Узнаём из первого отказа и больше не
   спрашиваем: до конца процесса параметр не отправляется. */
let запаснаяЦепочкаРаботает = FALLBACKS_ENABLED;

const этоОтказОтЗапаснойЦепочки = (err) =>
  /does not support the .?fallbacks.? parameter/i.test(err?.message || "");

// Потолок ответа. Перевод обычно длиннее оригинала — особенно на
// азербайджанском и турецком, — поэтому запас двукратный.
const MAX_TOKENS = 16000;

// Размер куска исходника. У Claude контекст большой, и дробить статью на
// куски по четыре тысячи знаков, как приходилось раньше, незачем: чем
// меньше кусков, тем меньше швов между ними.
const CHUNK_CHARS = Number(process.env.TRANSLATION_CHUNK_CHARS || 12000);

const SCHEMA = {
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
};

const SYSTEM_PROMPT = `You translate medical content for practising physicians.

Rules:
- Keep terminology precise; use the accepted clinical term in the target
  language, not a literal word-by-word rendering.
- Do not shorten, do not summarise, do not add commentary of your own.
- Preserve the structure of the source: paragraphs, headings, lists and any
  markdown or HTML markup stay exactly where they were.
- Numbers, units, dosages, gene and drug names, and citation markers are
  copied unchanged.
- Translate every field you are given; leave a field empty only if it was
  empty in the source.`;

const normalizeField = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    return Object.values(value).filter(Boolean).join(" ");
  }
  return String(value);
};

/** Один вызов модели: заголовок, аннотация и кусок текста. */
const translateSingle = async ({
  title,
  content,
  abstract = "",
  fromLanguage,
  toLanguage,
  model = MODEL_ПО_УМОЛЧАНИЮ,
}) => {
  let message;
  const запрос = (сЗапасными) =>
    getClient().beta.messages.stream({
      model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      output_config: {
        // Схема идёт ЗНАЧЕНИЕМ ключа schema, а не спредом: спред подмешал бы
        // сюда собственный type схемы поверх "json_schema", и API ответил бы
        // 400 на каждый запрос.
        format: {
          type: "json_schema",
          schema: prepareSchema(SCHEMA, logger, "перевод статьи"),
        },
        effort: EFFORT,
      },
      messages: [
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
      ...(сЗапасными ? { betas: [FALLBACK_BETA], fallbacks: "default" } : {}),
    });

  try {
    message = await запрос(запаснаяЦепочкаРаботает).finalMessage();
  } catch (err) {
    if (запаснаяЦепочкаРаботает && этоОтказОтЗапаснойЦепочки(err)) {
      // Модель запасную цепочку не понимает — она страховка, а не условие
      // работы. Повторяем без неё и больше не пробуем.
      запаснаяЦепочкаРаботает = false;
      try {
        message = await запрос(false).finalMessage();
      } catch (повтор) {
        throw new Error(
          `Ошибка перевода (${model} → ${toLanguage}): ${повтор?.message || повтор}`,
        );
      }
    } else {
      // Ошибку не проглатываем и исходником не подменяем: наверху есть
      // повторы, а «перевод», равный оригиналу, не отличить от настоящего.
      throw new Error(
        `Ошибка перевода (${model} → ${toLanguage}): ${err?.message || err}`,
      );
    }
  }

  if (message.stop_reason === "refusal") {
    throw new Error(
      `Модель отклонила перевод на ${toLanguage}: ${message.stop_details?.category ?? "без причины"}`,
    );
  }
  if (message.stop_reason === "max_tokens") {
    // Обрыв по длине лечится не повтором, а меньшим куском.
    throw new Error(
      `Ответ оборвался на пределе длины (${MAX_TOKENS} токенов) — уменьшите TRANSLATION_CHUNK_CHARS`,
    );
  }

  const текст = message.content
    ?.filter((б) => б.type === "text")
    .map((б) => б.text)
    .join("")
    .trim();

  if (!текст) throw new Error("Модель вернула пустой ответ");

  try {
    return JSON.parse(текст);
  } catch {
    throw new Error(
      `Модель вернула невалидный JSON вопреки схеме: ${текст.slice(0, 2000)}`,
    );
  }
};

/** Длинная статья: куски переводятся параллельно, без заголовка. */
const translateChunks = async ({ chunks, fromLanguage, toLanguage, model }) => {
  const результаты = await Promise.all(
    chunks.map((кусок) =>
      translateSingle({
        title: "",
        content: кусок,
        abstract: "",
        fromLanguage,
        toLanguage,
        model,
      }),
    ),
  );

  return результаты.map((р) => р.content).join("\n\n");
};

export const translate = async ({
  title,
  content,
  abstract = "",
  fromLanguage,
  toLanguage,
  model = MODEL_ПО_УМОЛЧАНИЮ,
}) => {
  const куски = splitTextIntoChunks(content, CHUNK_CHARS);

  if (куски.length === 1) {
    const итог = await translateSingle({
      title,
      content,
      abstract,
      fromLanguage,
      toLanguage,
      model,
    });

    return {
      title: normalizeField(итог.title),
      abstract: normalizeField(итог.abstract),
      content: normalizeField(итог.content),
    };
  }

  // Заголовок и аннотация переводятся отдельным коротким вызовом: гнать
  // ради них весь текст ещё раз — лишние деньги, а склеивать их из первого
  // куска нельзя, куски переводятся без заголовка намеренно.
  const [переведённыйТекст, шапка] = await Promise.all([
    translateChunks({ chunks: куски, fromLanguage, toLanguage, model }),
    translateSingle({
      title,
      abstract,
      content: куски[0].slice(0, 500),
      fromLanguage,
      toLanguage,
      model,
    }),
  ]);

  return {
    title: normalizeField(шапка.title),
    abstract: normalizeField(шапка.abstract),
    content: normalizeField(переведённыйТекст),
  };
};

export default translate;
