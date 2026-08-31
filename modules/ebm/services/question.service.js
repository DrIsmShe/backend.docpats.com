// server/modules/ebm/services/question.service.js
//
// Вопрос врача → запрос к PubMed.
//
// ГДЕ ЗДЕСЬ МОДЕЛЬ И ПОЧЕМУ ЭТО БЕЗОПАСНО.
//
// В первом этапе модели не было вовсе: врач писал запрос сам, синтаксисом
// PubMed и по-английски. Для врача, который спрашивает по-русски, по-турецки
// или по-азербайджански, это означало, что системы нет.
//
// Модель появляется здесь и делает ровно одну вещь: превращает свободный
// вопрос в ПОИСКОВЫЙ ЗАПРОС. Она не отвечает на вопрос, не называет
// исследований, не оценивает лечение. Запрос уходит в PubMed, и что вернулось,
// то вернулось — выдумать публикацию на этом пути невозможно физически.
//
// Худшее, что может сделать модель, — построить плохой запрос. Это видно
// сразу: находок мало или не по теме, а сам запрос показывается врачу и
// правится вручную. Сравните с этапом, где модель называет источники: там
// ошибка невидима, и мы её уже измеряли — 14 несуществующих работ из 80.
//
// PICO — стандартная рамка клинического вопроса: Population (кто),
// Intervention (что делаем), Comparison (с чем сравниваем), Outcome (что
// хотим получить). Показывается врачу не для красоты: по ней видно, ПРАВИЛЬНО
// ЛИ ПОНЯТ вопрос, ещё до чтения результатов.

import {
  getClient,
  withApiRetry,
  describeApiError,
} from "../../education/education-ingest/extractors/claude.extractor.js";
import {
  ServiceUnavailableError,
  ValidationError,
} from "../../../common/utils/errors.js";
import logger from "../../../common/logger.js";
import { prepareSchema } from "../../../common/utils/structuredOutputSchema.js";
import { searchEvidence } from "./evidence.service.js";

// Модель. Задача переводческая: клинические понятия → английские термины и
// синтаксис PubMed. Медицинских данных здесь не сочиняется, поэтому Opus (как
// в radiology, где кейс придумывается целиком) не нужен.
const MODEL = process.env.EBM_AI_MODEL || "claude-sonnet-5";

// Запасная модель при перегрузке основной. Врач ждёт ответа прямо сейчас —
// «попробуйте позже» здесь дороже, чем разница между моделями на задаче
// перевода терминов.
const FALLBACK_MODEL =
  process.env.EBM_AI_FALLBACK_MODEL === "off"
    ? null
    : process.env.EBM_AI_FALLBACK_MODEL || "claude-opus-5";

const QUESTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "isClinical",
    "pico",
    "query",
    "broadQuery",
    "englishTerms",
    "note",
  ],
  properties: {
    isClinical: {
      type: "boolean",
      description:
        "Есть ли в вопросе медицинское содержание, по которому в принципе можно искать. false ТОЛЬКО для приветствий, вопросов про саму систему, административных вопросов и текста без медицинского смысла. Экзотический, редкий или странно звучащий клинический вопрос — это true: пусть PubMed ответит, что работ нет.",
    },
    pico: {
      type: "object",
      additionalProperties: false,
      required: ["population", "intervention", "comparison", "outcome"],
      description:
        "Разбор вопроса по PICO НА ЯЗЫКЕ ВОПРОСА ВРАЧА (не по-английски, если врач спросил не по-английски) — его увидит врач и проверит, правильно ли понят вопрос. Пустая строка, если грань в вопросе не задана: не додумывай за врача.",
      properties: {
        population: {
          type: "string",
          description: "Кто: группа пациентов, состояние.",
        },
        intervention: {
          type: "string",
          description: "Что делаем: препарат, вмешательство, фактор.",
        },
        comparison: {
          type: "string",
          description:
            "С чем сравниваем. Часто не задано — тогда пустая строка.",
        },
        outcome: {
          type: "string",
          description: "Что хотим получить или измерить.",
        },
      },
    },
    query: {
      type: "string",
      description:
        "Запрос в синтаксисе PubMed. Грани соединяй через AND, синонимы внутри грани — через OR в скобках. Используй термины MeSH там, где уверен: (\"prediabetic state\"[mh] OR prediabetes[tiab]). НЕ добавляй фильтры по типу публикации, по дате и NOT-исключения — это делается отдельно и без тебя.",
    },
    broadQuery: {
      type: "string",
      description:
        "Тот же вопрос, но заведомо шире: только 1-2 главных понятия, без второстепенных граней. Нужен на случай, если точный запрос не найдёт ничего. Никогда не оставляй пустым.",
    },
    englishTerms: {
      type: "array",
      items: { type: "string" },
      description:
        "Ключевые английские термины, которые ты использовал. Врач увидит их и сможет искать в PubMed сам.",
    },
    note: {
      type: "string",
      description:
        "Что осталось неясным в вопросе или какое допущение ты сделал, НА ЯЗЫКЕ ВОПРОСА ВРАЧА. Пустая строка, если вопрос однозначен. Не пиши здесь клинических советов.",
    },
  },
};

const SYSTEM = `Ты помогаешь врачу искать доказательства в PubMed.

Твоя единственная задача — превратить вопрос врача в поисковый запрос PubMed.

Категорически запрещено:
— отвечать на клинический вопрос по существу;
— называть конкретные исследования, авторов, журналы, годы, PMID или DOI;
— оценивать эффективность или безопасность вмешательства;
— давать рекомендации по лечению.

Всё это сделают другие: запрос уйдёт в PubMed, и врач прочитает настоящие
работы. Любая названная тобой публикация была бы выдумкой — ты не имеешь
доступа к базе.

Как строить запрос:
— вопрос может быть на любом языке, запрос всегда английский: PubMed
  индексирован только по-английски;
— а вот разбор PICO и note пиши НА ЯЗЫКЕ ВОПРОСА: их читает врач, и разбор
  по-английски для него бесполезен ровно так же, как запрос по-русски для
  PubMed;
— разбери вопрос по граням PICO и соедини грани через AND;
— внутри грани перечисли синонимы через OR в скобках, включая MeSH-рубрику и
  свободный текст: ("prediabetic state"[mh] OR prediabetes[tiab]);
— чем больше граней, тем уже выдача. Две-три грани обычно лучше четырёх:
  недостающее врач добавит сам, а пустая выдача не говорит ничего;
— не добавляй фильтры по типу публикации ("meta-analysis"[pt]), по дате и
  NOT-исключения: они добавляются автоматически на следующем шаге, и твой
  дубликат сузит поиск дважды.

Если в вопросе нет медицинского содержания (приветствие, вопрос про саму
систему, бессвязный текст) — поставь isClinical: false и не выдумывай запрос.

Во всех остальных случаях ставь true и строй запрос, даже если вопрос кажется
тебе редким, экзотическим или маловероятным. Решать, изучена тема или нет, —
не твоё дело: на это ответит сам PubMed, и честное «работ не найдено» врачу
полезнее твоего отказа. Ты можешь ошибиться в оценке правдоподобия; PubMed в
том, есть ли публикации, — не может.`;

/**
 * Разбирает вопрос врача и строит запрос к PubMed.
 *
 * @param {string} question свободный текст на любом языке
 * @returns {Promise<object>} разбор PICO, запрос и запасной широкий запрос
 */
export async function parseQuestion(question) {
  const clean = String(question || "").trim();
  if (clean.length < 5) {
    throw new ValidationError("Вопрос слишком короткий", { i18n: "app.question.tooShort" });
  }
  if (clean.length > 1000) {
    throw new ValidationError("Вопрос слишком длинный — сформулируйте короче", { i18n: "app.question.tooLong" });
  }

  if (!isAiConfigured()) {
    throw new ServiceUnavailableError(
      "Разбор вопроса недоступен: не задан ANTHROPIC_API_KEY. Поиск по запросу PubMed работает без него — /api/v1/ebm/search",
    );
  }

  const client = getClient();

  let message;
  try {
    message = await withApiRetry(
      async (attemptModel) =>
        client.beta.messages.create({
          model: attemptModel,
          max_tokens: 3000,
          thinking: { type: "adaptive" },
          system: SYSTEM,
          output_config: {
            format: {
              type: "json_schema",
              schema: prepareSchema(QUESTION_SCHEMA, logger, "ebm-question"),
            },
          },
          messages: [{ role: "user", content: `Вопрос врача: ${clean}` }],
        }),
      {
        logger,
        what: "разбор вопроса",
        model: MODEL,
        fallbackModel: FALLBACK_MODEL,
      },
    );
  } catch (err) {
    const described = describeApiError(err);
    logger?.error?.(
      { err, model: MODEL, status: err?.status ?? null },
      "ebm: разбор вопроса не удался",
    );
    throw described.retryable
      ? new ServiceUnavailableError(described.message)
      : new ValidationError(described.message);
  }

  // Отказ модели на клиническом вопросе — не редкость: описание отравления,
  // передозировки или инфекции легко выглядит «опасной темой» для фильтра.
  // Врачу нужно понимать, что дело в формулировке, а не в отсутствии данных.
  if (message.stop_reason === "refusal") {
    logger?.warn?.(
      {
        category: message.stop_details?.category ?? null,
        model: message.model,
      },
      "ebm: модель отклонила вопрос",
    );
    throw new ValidationError(
      "Модель отказалась разбирать этот вопрос — переформулируйте нейтральнее. Поиск по запросу PubMed напрямую работает без неё: /api/v1/ebm/search",
    );
  }
  if (message.stop_reason === "max_tokens") {
    // Оборванный ответ — это невалидный JSON, а не «немного короче».
    throw new ServiceUnavailableError(
      "Ответ модели оборвался — задайте вопрос короче",
    );
  }

  const parsed = extractJson(message);

  return {
    isClinical: Boolean(parsed.isClinical),
    pico: parsed.pico || {},
    query: String(parsed.query || "").trim(),
    broadQuery: String(parsed.broadQuery || "").trim(),
    englishTerms: Array.isArray(parsed.englishTerms) ? parsed.englishTerms : [],
    note: String(parsed.note || "").trim(),
    model: message?.model || MODEL,
  };
}

/**
 * Полный путь: вопрос врача → разбор → поиск доказательств.
 *
 * @param {object} args
 * @param {string} args.question
 * @param {number} [args.perLevel]
 * @param {number} [args.yearsBack]
 * @returns {Promise<object>}
 */
export async function askEvidence({
  question,
  perLevel = 5,
  yearsBack = 0,
} = {}) {
  const parsed = await parseQuestion(question);

  if (!parsed.isClinical || !parsed.query) {
    // PubMed не тревожим вовсе: на «здравствуйте» он ответит миллионом работ
    // по слову hello, и это будет выглядеть как результат.
    return {
      question,
      understood: parsed,
      searched: null,
      verdict: {
        kind: "not_clinical",
        text:
          parsed.note ||
          "Это не клинический вопрос — на такие медицинские исследования не отвечают. Спросите о пациентах, вмешательстве и исходе.",
      },
    };
  }

  let result = await searchEvidence({
    term: parsed.query,
    perLevel,
    yearsBack,
  });
  let usedQuery = parsed.query;
  let widened = false;

  // Точный запрос ничего не дал — пробуем широкий.
  //
  // Пустая выдача не означает «доказательств нет»: чаще она означает, что
  // граней в запросе оказалось слишком много. Врач без опыта работы с PubMed
  // этого не различит и уйдёт с выводом, что по его вопросу не исследовано
  // ничего. Широкий запрос модель отдаёт сразу, вторым полем, — значит второй
  // вызов модели не нужен.
  if (
    result.totalAnyDesign === 0 &&
    parsed.broadQuery &&
    parsed.broadQuery !== parsed.query
  ) {
    const broad = await searchEvidence({
      term: parsed.broadQuery,
      perLevel,
      yearsBack,
    });
    if (broad.totalAnyDesign > 0) {
      result = broad;
      usedQuery = parsed.broadQuery;
      widened = true;
    }
  }

  return {
    question,
    understood: parsed,
    // Какой именно запрос дал этот результат — врач должен видеть, по чему
    // ему отвечают, иначе система превращается в оракула.
    usedQuery,
    widened,
    ...result,
  };
}

/** Настроен ли доступ к модели. */
export function isAiConfigured() {
  return Boolean(
    (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "")
      .trim(),
  );
}

/**
 * Достаёт структурированный ответ из сообщения.
 *
 * При adaptive thinking первым блоком идёт размышление, а не результат, —
 * брать content[0] нельзя. Это уже ломало модуль справочника кодов, поэтому
 * ищем блок явно.
 */
function extractJson(message) {
  const blocks = Array.isArray(message?.content) ? message.content : [];

  for (const block of blocks) {
    if (block?.type === "json" && block.json) return block.json;
    if (block?.type === "text" && block.text) {
      try {
        return JSON.parse(block.text);
      } catch {
        // Не JSON — возможно, это текстовое рассуждение перед ответом.
      }
    }
  }

  throw new ServiceUnavailableError(
    "Модель вернула ответ в неожиданном виде — попробуйте ещё раз",
  );
}

export default { parseQuestion, askEvidence, isAiConfigured };
