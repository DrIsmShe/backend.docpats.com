// server/modules/medicalCodes/services/codeTranslation.service.js
//
// Перевод названий кодов МКБ на языки системы.
//
// ПОЧЕМУ МОДЕЛЬ, А НЕ ОФИЦИАЛЬНЫЕ ПЕРЕВОДЫ ВОЗ. Официальные переводы есть, но
// только для версии ВОЗ (~14 000 рубрик) и только на часть языков: русский
// есть, азербайджанского и турецкого нет. Загруженный справочник — МКБ-10-CM,
// американская клиническая модификация на 74 719 кодов, и для неё переводов не
// существует в природе. Поэтому переводим сами, а когда появится доступ к
// ICD API, официальные названия ВОЗ можно будет положить поверх — они точнее.
//
// ПОЧЕМУ ПАЧКАМИ, А НЕ ПО ОДНОМУ. 74 тысячи отдельных запросов — это и деньги,
// и часы ожидания. Пачка в 50 названий переводится одним вызовом.
//
// ЧЕГО ЗДЕСЬ СОЗНАТЕЛЬНО НЕТ: автоматического перевода всего справочника при
// старте. Перевод стоит денег, и решение потратить их принимает человек,
// запуская скрипт, — а не сервер, поднявшийся после рестарта.

import {
  getClient,
  isConfigured,
  describeApiError,
} from "../../education/education-ingest/extractors/claude.extractor.js";
import MedicalCode, {
  SUPPORTED_LOCALES,
  searchTextExpression,
} from "../models/medicalCode.model.js";
import logger from "../../../common/logger.js";

// Поднимать при каждой правке промпта: по версии видно, каким текстом получен
// перевод полугодовой давности.
export const PROMPT_VERSION = "mc-tr-2026-08-11";

export const MODEL = process.env.MEDICAL_CODES_TRANSLATION_MODEL || "claude-opus-5";

// Сколько названий уходит в один запрос. Больше — дешевле, но выше риск, что
// модель собьётся с нумерации на длинном списке.
export const BATCH_SIZE = Number(process.env.MEDICAL_CODES_TRANSLATION_BATCH ?? 50);

// Расход токенов за текущий запуск. Живёт в модуле, а не возвращается из
// translateBatch: у неё уже есть осмысленный результат — сколько кодов
// записано, — и подмешивать туда бухгалтерию значило бы ломать вызывающих.
// Повторы на одну пачку и паузы между ними. Перевод справочника — часы работы,
// и за это время разовый сбой почти неизбежен: прекращать из-за него весь
// прогон значило бы не доводить перевод до конца никогда.
const RETRIES_PER_BATCH = Number(process.env.MEDICAL_CODES_TRANSLATION_RETRIES ?? 2);
const RETRY_DELAYS_MS = [5_000, 20_000, 60_000];

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const usage = { requests: 0, inputTokens: 0, outputTokens: 0 };

/** Расход с начала процесса (или с последнего resetUsage). */
export function getUsage() {
  return { ...usage };
}

export function resetUsage() {
  usage.requests = 0;
  usage.inputTokens = 0;
  usage.outputTokens = 0;
}

const LANGUAGE_NAMES = {
  ru: "русский",
  az: "азербайджанский",
  tr: "турецкий",
  ar: "арабский",
};

function buildPrompt(items, targetLocale) {
  const languageName = LANGUAGE_NAMES[targetLocale] || targetLocale;

  const list = items
    .map((item, index) => `${index + 1}. [${item.code}] ${item.titles.en}`)
    .join("\n");

  return `Ты — медицинский переводчик, работающий с Международной классификацией болезней (МКБ-10).

Переведи названия диагнозов на ${languageName} язык.

ТРЕБОВАНИЯ:
1. Используй официальную медицинскую терминологию МКБ-10, принятую в этом языке, а не буквальный перевод.
2. Сохраняй уточнения из оригинала: "unspecified" — "неуточнённый", "acute" — "острый", "chronic" — "хронический", сторона тела (right/left), рецидивирующий характер.
3. Не добавляй пояснений, не убирай уточнений, не сокращай.
4. Анатомические термины переводи так, как принято в клинической практике этого языка.
5. Если для термина нет устоявшегося перевода — дай точный по смыслу, не транслитерацию.

Верни ТОЛЬКО JSON-массив строк, по одной на каждый пункт, в том же порядке. Без markdown, без комментариев, без нумерации внутри строк.

Пример формата ответа:
["Хронический тонзиллит","Острый синусит"]

СПИСОК (${items.length} шт.):
${list}`;
}

/**
 * Разбирает ответ модели. Отдельная функция, потому что это самое хрупкое
 * место: модель может обернуть массив в markdown или добавить пояснение.
 */
function parseTranslations(text, expectedCount) {
  const cleaned = String(text || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) {
    throw new Error("В ответе модели нет JSON-массива");
  }

  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  if (!Array.isArray(parsed)) {
    throw new Error("Ответ модели — не массив");
  }

  // Длина обязана совпасть. Сдвиг на один элемент означал бы, что переводы
  // разъедутся по кодам: гастрит получит название синусита. Молча принять
  // такое нельзя — лучше отказаться от всей пачки.
  if (parsed.length !== expectedCount) {
    throw new Error(
      `Модель вернула ${parsed.length} переводов вместо ${expectedCount}`,
    );
  }

  return parsed.map((value) => String(value || "").trim());
}

/**
 * Переводит одну пачку кодов на один язык и сохраняет результат.
 *
 * @returns {Promise<number>} сколько кодов реально обновлено
 */
export async function translateBatch(items, targetLocale) {
  if (!isConfigured()) {
    throw new Error("ANTHROPIC_API_KEY не задан — переводить нечем");
  }
  if (!SUPPORTED_LOCALES.includes(targetLocale) || targetLocale === "en") {
    throw new Error(`Неподдерживаемый язык перевода: ${targetLocale}`);
  }
  if (items.length === 0) return 0;

  let text;
  try {
    const message = await getClient().messages.create({
      model: MODEL,
      max_tokens: 8000,
      messages: [{ role: "user", content: buildPrompt(items, targetLocale) }],
    });

    // Отказ классификатора — штатный ответ с HTTP 200, а не ошибка. На
    // медицинском материале (травмы, отравления, токсикология) случается.
    if (message.stop_reason === "refusal") {
      throw new Error("Модель отказалась переводить эту пачку");
    }

    // Берём блок ТИПА text, а не content[0]. У современных моделей мышление
    // включено по умолчанию, и первым в ответе идёт блок thinking — обращение
    // к content[0].text даёт undefined при совершенно нормальном ответе.
    text = message.content?.find((block) => block.type === "text")?.text;
    if (!text) throw new Error("Пустой ответ модели");

    // Расход считаем здесь, а не по прикидке «сколько это может стоить»:
    // перевод всего справочника на язык — это полторы тысячи запросов, и
    // решение «переводить ли остальные четыре языка» принимается по реальной
    // цифре после первой сотни пачек, а не по догадке.
    usage.requests += 1;
    usage.inputTokens += message.usage?.input_tokens ?? 0;
    usage.outputTokens += message.usage?.output_tokens ?? 0;
  } catch (err) {
    // describeApiError отдаёт объект {retryable, message}, а не строку:
    // передать его в Error целиком — получить "[object Object]" вместо причины.
    const described = describeApiError?.(err);
    throw new Error(described?.message || err.message || "Ошибка вызова модели");
  }

  const translations = parseTranslations(text, items.length);

  const operations = [];
  for (let i = 0; i < items.length; i++) {
    const translation = translations[i];
    // Пустой перевод пропускаем: лучше оставить английское название, чем
    // записать пустую строку и потерять возможность найти код вообще.
    if (!translation) continue;

    // Пайплайн из двух шагов, а не один $set: во втором шаге выражение видит
    // уже записанный перевод, и строка поиска пересобирается сервером по
    // актуальному документу. Так параллельные языки не затирают друг друга —
    // подробности в searchTextExpression().
    operations.push({
      updateOne: {
        filter: { _id: items[i]._id },
        update: [
          { $set: { [`titles.${targetLocale}`]: translation } },
          { $set: { searchText: searchTextExpression() } },
        ],
      },
    });
  }

  if (operations.length === 0) return 0;

  const result = await MedicalCode.bulkWrite(operations, { ordered: false });
  return result.modifiedCount || 0;
}

/**
 * Сколько кодов ещё без перевода на этот язык.
 */
export async function countUntranslated(targetLocale, { system = null } = {}) {
  const filter = {
    $or: [
      { [`titles.${targetLocale}`]: "" },
      { [`titles.${targetLocale}`]: { $exists: false } },
    ],
  };
  if (system) filter.system = system;
  return MedicalCode.countDocuments(filter);
}

/**
 * Следующая порция кодов без перевода.
 *
 * Порядок — по коду, а не случайный: так повторный запуск после сбоя идёт
 * дальше по справочнику, а не топчется по уже переведённому.
 */
export async function nextUntranslatedBatch(
  targetLocale,
  { system = null, limit = BATCH_SIZE, skip = 0 } = {},
) {
  const filter = {
    $or: [
      { [`titles.${targetLocale}`]: "" },
      { [`titles.${targetLocale}`]: { $exists: false } },
    ],
  };
  if (system) filter.system = system;

  return MedicalCode.find(filter)
    .sort({ code: 1 })
    .skip(skip)
    .limit(limit)
    .select("_id code titles")
    .lean();
}

/**
 * Переводит указанное количество кодов, пачками.
 *
 * @param {string} targetLocale
 * @param {object} options
 * @param {number} options.max      сколько кодов перевести за запуск
 * @param {string} [options.system]
 * @param {Function} [options.onProgress]
 * @param {Function} [options.shouldStop] вызывается ПЕРЕД каждой пачкой;
 *   вернула true — прогон завершается штатно. Через неё скрипт держит потолок
 *   трат: массовый перевод идёт часами без присмотра и тратит тот же баланс,
 *   что надиктовка, диагностика и ночная генерация кейсов. Без потолка деньги
 *   могут кончиться ночью, а обнаружится это утром отказом у врача.
 */
export async function translateCodes(
  targetLocale,
  {
    max = BATCH_SIZE,
    system = null,
    onProgress = null,
    retries = RETRIES_PER_BATCH,
    sleep = defaultSleep,
    shouldStop = null,
  } = {},
) {
  let translated = 0;
  let failedBatches = 0;
  let stoppedBy = null;
  // Насколько отступить от начала списка непереведённых. Пачка, которая не
  // далась и после повторов, остаётся непереведённой и снова оказалась бы
  // первой в выборке — без этого смещения перевод бесконечно топтался бы
  // на ней. Смещение сбрасывается после каждой удачной пачки.
  let skip = 0;

  while (translated < max) {
    // Проверяем ДО запроса, а не после: потолок должен не дать потратить
    // лишнее, а не сообщить, что уже потратили.
    const stop = await shouldStop?.({ translated, usage: getUsage() });
    if (stop) {
      stoppedBy = typeof stop === "string" ? stop : "shouldStop";
      break;
    }

    const limit = Math.min(BATCH_SIZE, max - translated);
    const batch = await nextUntranslatedBatch(targetLocale, {
      system,
      limit,
      skip,
    });
    if (batch.length === 0) break;

    let lastError = null;
    let done = false;

    // Повторы на ту же пачку. Перевод всего справочника — это часы работы и
    // тысячи запросов; за это время разовый сбой (перегрузка, обрыв сети,
    // упор в лимит) практически неизбежен, и прекращать из-за него всю
    // работу — значит не доводить её до конца никогда.
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const count = await translateBatch(batch, targetLocale);
        translated += count;
        skip = 0;
        failedBatches = 0;
        onProgress?.({ translated, lastBatch: count, total: max });
        done = true;
        break;
      } catch (err) {
        lastError = err;
        if (attempt < retries) {
          // Пауза растёт: 5с, 20с, 60с. Быстрый повтор при перегрузке
          // сервиса только усугубляет её.
          await sleep(RETRY_DELAYS_MS[attempt] ?? 60_000);
        }
      }
    }

    if (done) continue;

    failedBatches++;
    logger?.warn?.(
      {
        err: lastError?.message,
        locale: targetLocale,
        codes: batch.length,
        attempts: retries + 1,
      },
      "medicalCodes: пачка не переведена",
    );

    // Три пачки подряд — значит дело не в конкретных названиях, а в общем:
    // кончились кредиты, отозван ключ, сервис недоступен. Продолжать значит
    // жечь запросы впустую.
    if (failedBatches >= 3) {
      throw new Error(
        `Три пачки подряд не переведены, последняя ошибка: ${lastError?.message}`,
      );
    }

    // Не далась одна пачка — переступаем через неё и идём дальше. Она
    // осталась непереведённой и будет подобрана следующим запуском.
    skip += batch.length;
  }

  return { translated, failedBatches, stoppedBy };
}
