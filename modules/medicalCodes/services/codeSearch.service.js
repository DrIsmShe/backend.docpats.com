// server/modules/medicalCodes/services/codeSearch.service.js
//
// Поиск по справочнику кодов.
//
// Две стратегии, и это не перестраховка ради красоты:
//
//   atlas — $search по индексу Atlas Search. Терпит опечатки ("тонзилит"),
//     понимает частичные слова, ранжирует осмысленно. Требует индекса в Atlas —
//     его заводит scripts/createSearchIndex.js (см. README).
//   regex — обычный Mongo. Работает всегда и везде: локально, в тестах против
//     mongodb-memory-server, на самоподнятом Mongo. Опечатки не прощает.
//
// Стратегия выбирается один раз при первом запросе: пробуем $search, при
// ошибке запоминаем, что его нет, и дальше идём коротким путём. Проверять
// наличие индекса на каждый ввод буквы было бы дорого.

import MedicalCode, {
  CODE_SYSTEMS,
  SUPPORTED_LOCALES,
  normalizeCode,
} from "../models/medicalCode.model.js";

// Имя индекса Atlas Search. Должно совпадать с тем, что создано в Atlas UI.
const ATLAS_INDEX = "medical_codes_search";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// null — ещё не проверяли; true/false — выясненный ответ.
let atlasSearchAvailable = null;
// Промис проверки: параллельные запросы не должны запускать её несколько раз.
let strategyProbe = null;

/** Сбрасывает запомненную стратегию. Нужен тестам и после создания индекса. */
export function resetSearchStrategy() {
  atlasSearchAvailable = null;
  strategyProbe = null;
}

/**
 * Есть ли индекс Atlas Search.
 *
 * Проверяется ЯВНО через $listSearchIndexes, а не по ошибке от $search. Причина
 * дорого стоила: на Atlas запрос $search к НЕсуществующему индексу не падает —
 * он молча возвращает пустой результат. Стратегия «попробуем, поймаем ошибку»
 * поэтому не срабатывала: ошибки нет, есть ноль документов, и врач видел бы
 * «ничего не найдено» при полностью загруженном справочнике.
 *
 * На не-Atlas (локальный Mongo, mongodb-memory-server в тестах) команда
 * не поддерживается и бросает — это честный сигнал, что Atlas Search нет.
 */
async function detectAtlasSearch() {
  try {
    const indexes = await MedicalCode.aggregate([
      { $listSearchIndexes: {} },
    ]).exec();

    const found = indexes.some(
      (idx) => idx.name === ATLAS_INDEX && idx.status !== "FAILED",
    );

    if (!found) {
      console.warn(
        `[medicalCodes] Индекс Atlas Search "${ATLAS_INDEX}" не найден — ` +
          `поиск идёт обычным Mongo (без учёта опечаток). Создайте индекс, см. README.`,
      );
    }
    return found;
  } catch {
    // Не Atlas или версия без $listSearchIndexes — работаем обычным Mongo.
    return false;
  }
}

/** Стратегия поиска: определяется один раз, дальше берётся из памяти. */
async function ensureStrategy() {
  if (atlasSearchAvailable !== null) return atlasSearchAvailable;
  if (!strategyProbe) {
    strategyProbe = detectAtlasSearch().then((result) => {
      atlasSearchAvailable = result;
      return result;
    });
  }
  return strategyProbe;
}

/**
 * Экранирует пользовательский ввод для regex. Без этого "C09.9" в поиске
 * превратился бы в шаблон с любым символом вместо точки, а "(" уронил бы
 * запрос синтаксической ошибкой.
 */
function escapeRegex(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Поле названия для нужного языка с откатом на английский: пока переводов нет,
 * врач должен видеть хоть что-то, а не пустую строку.
 */
function pickTitle(titles, locale) {
  if (!titles) return "";
  return titles[locale] || titles.en || "";
}

function toResult(doc, locale) {
  return {
    system: doc.system,
    code: doc.code,
    title: pickTitle(doc.titles, locale),
    // Английское название отдаём всегда: врач часто сверяется с оригиналом,
    // а при отсутствующем переводе это единственное, что есть.
    titleEn: doc.titles?.en || "",
    isBillable: doc.isBillable !== false,
    parentCode: doc.parentCode || "",
  };
}

/**
 * Поиск через Atlas Search. Бросает исключение, если индекса нет, — вызывающий
 * код по этому и понимает, что надо переключиться на regex.
 */
async function searchWithAtlas({ query, system, locale, limit }) {
  const normalized = normalizeCode(query);

  const pipeline = [
    {
      $search: {
        index: ATLAS_INDEX,
        compound: {
          should: [
            // Точное совпадение кода — всегда первым, с большим весом:
            // если врач набрал "J35.01", он хочет именно его, а не похожие
            // по названию.
            {
              text: {
                query: normalized,
                path: "codeNormalized",
                score: { boost: { value: 10 } },
              },
            },
            // Начало кода: набрал "J35" — показать всю рубрику.
            {
              autocomplete: {
                query: normalized,
                path: "codeNormalized",
                score: { boost: { value: 5 } },
              },
            },
            // Названия на всех языках, с допуском на одну-две опечатки.
            ...SUPPORTED_LOCALES.map((loc) => ({
              text: {
                query,
                path: `titles.${loc}`,
                fuzzy: { maxEdits: 1, prefixLength: 2 },
                // Язык запроса весит больше остальных: русский врач ищет
                // по-русски, и совпадение в турецком названии не должно
                // обгонять совпадение в русском.
                score: { boost: { value: loc === locale ? 3 : 1 } },
              },
            })),
          ],
          minimumShouldMatch: 1,
        },
      },
    },
  ];

  if (system) {
    pipeline.push({ $match: { system } });
  }

  pipeline.push({ $limit: limit });

  return MedicalCode.aggregate(pipeline).exec();
}

/**
 * Запасной поиск на обычном Mongo. Порядок важен: сначала совпадения по коду,
 * потом по названию, иначе врач, набравший код, увидит сначала чужие болезни
 * с похожими словами.
 */
async function searchWithRegex({ query, system, locale, limit }) {
  const normalized = normalizeCode(query);
  const base = system ? { system } : {};
  const results = [];
  const seen = new Set();

  const push = (docs) => {
    for (const doc of docs) {
      const key = `${doc.system}:${doc.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(doc);
    }
  };

  // 1. Код с начала строки — самый точный сигнал.
  if (normalized) {
    push(
      await MedicalCode.find({
        ...base,
        codeNormalized: new RegExp(`^${escapeRegex(normalized)}`),
      })
        .limit(limit)
        .lean(),
    );
  }

  // 2. Название на языке запроса, затем на английском. Ищем вхождение, а не
  // начало строки: «тонзиллит» стоит в середине «Хронический тонзиллит».
  if (results.length < limit && query.length >= 2) {
    const rx = new RegExp(escapeRegex(query), "i");
    const titleFields = [`titles.${locale}`, "titles.en"];

    for (const field of titleFields) {
      if (results.length >= limit) break;
      push(
        await MedicalCode.find({ ...base, [field]: rx })
          .limit(limit - results.length)
          .lean(),
      );
    }
  }

  return results.slice(0, limit);
}

/**
 * Ищет коды.
 *
 * @param {object} params
 * @param {string} params.query   что набрал врач: код или часть названия
 * @param {string} [params.system] ограничить системой (icd10cm/icd10who/ichi)
 * @param {string} [params.locale] язык интерфейса врача
 * @param {number} [params.limit]
 * @returns {Promise<{items: Array, strategy: string}>}
 */
export async function searchCodes({
  query,
  system = null,
  locale = "ru",
  limit = DEFAULT_LIMIT,
} = {}) {
  const trimmed = String(query || "").trim();
  if (trimmed.length < 2) {
    return { items: [], strategy: "none" };
  }

  const safeLocale = SUPPORTED_LOCALES.includes(locale) ? locale : "en";
  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const safeSystem = Object.values(CODE_SYSTEMS).includes(system) ? system : null;

  const args = {
    query: trimmed,
    system: safeSystem,
    locale: safeLocale,
    limit: safeLimit,
  };

  if (await ensureStrategy()) {
    try {
      const docs = await searchWithAtlas(args);

      // Пустой ответ Atlas — не всегда «ничего нет»: индекс мог не догнать
      // свежие документы (индексация асинхронная) или запрос попал в поле,
      // которого нет в маппинге. Перепроверяем обычным Mongo, прежде чем
      // сказать врачу «не найдено».
      if (docs.length > 0) {
        return {
          items: docs.map((d) => toResult(d, safeLocale)),
          strategy: "atlas",
        };
      }
    } catch (err) {
      console.warn(
        `[medicalCodes] Запрос к Atlas Search не выполнился (${err.message}) — ` +
          `отвечаю обычным Mongo`,
      );
    }
  }

  const docs = await searchWithRegex(args);
  return { items: docs.map((d) => toResult(d, safeLocale)), strategy: "regex" };
}

/** Точное получение одного кода — для подстановки названия к уже known коду. */
export async function getCode({ code, system = CODE_SYSTEMS.ICD10CM, locale = "ru" }) {
  const doc = await MedicalCode.findOne({
    system,
    codeNormalized: normalizeCode(code),
  }).lean();

  if (!doc) return null;
  const safeLocale = SUPPORTED_LOCALES.includes(locale) ? locale : "en";
  return toResult(doc, safeLocale);
}

/** Что вообще загружено — для страницы модуля и диагностики. */
export async function getStats() {
  // Сколько кодов переведено на каждый язык — это метрика готовности этапа
  // мультиязычности: пока переводов нет, врач ищет по-английски.
  const translatedCounters = {};
  for (const locale of SUPPORTED_LOCALES) {
    if (locale === "en") continue;
    translatedCounters[locale] = {
      $sum: { $cond: [{ $gt: [`$titles.${locale}`, ""] }, 1, 0] },
    };
  }

  const rows = await MedicalCode.aggregate([
    {
      $group: {
        _id: "$system",
        total: { $sum: 1 },
        billable: { $sum: { $cond: ["$isBillable", 1, 0] } },
        ...translatedCounters,
      },
    },
  ]).exec();

  const bySystem = {};
  for (const row of rows) {
    const translated = {};
    for (const locale of SUPPORTED_LOCALES) {
      if (locale === "en") continue;
      translated[locale] = row[locale] || 0;
    }
    bySystem[row._id] = {
      total: row.total,
      billable: row.billable,
      translated,
    };
  }

  return {
    bySystem,
    total: rows.reduce((sum, r) => sum + r.total, 0),
    searchStrategy: (await ensureStrategy()) ? "atlas" : "regex",
  };
}
