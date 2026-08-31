// common/i18n/index.js
//
// Перевод сообщений, которые сервер отдаёт человеку.
//
// Зачем. До сих пор сервер отвечал только по-русски: «Аналитика входит в
// тарифы Business и Enterprise», «Пациент не найден», «Слишком много
// попыток». В переведённом интерфейсе такие фразы выглядят как
// недоделанный перевод, хотя переведено всё, кроме них.
//
// Как устроено. Сообщение задаётся КОДОМ, а не текстом. Текст берётся из
// словаря по коду и языку, который клиент прислал заголовком. Кода нет в
// словаре — отдаём запасной текст, переданный вызывающим: сообщение не
// должно исчезать из-за того, что его забыли перевести.
//
// Чего здесь намеренно нет. Ни библиотеки, ни загрузки файлов с диска, ни
// вложенных пространств имён. Сообщений на сервере несколько сотен, они
// короткие и меняются редко; всё это добавило бы зависимостей и точек
// отказа больше, чем пользы.

import ru from "./dictionaries/ru.js";
import en from "./dictionaries/en.js";
import az from "./dictionaries/az.js";
import tr from "./dictionaries/tr.js";
import ar from "./dictionaries/ar.js";

const DICTIONARIES = { ru, en, az, tr, ar };
const DEFAULT_LANG = "ru";
export const SUPPORTED = Object.keys(DICTIONARIES);

/**
 * Язык запроса.
 *
 * X-Language ставит клиент по выбору в интерфейсе. Accept-Language ставит
 * браузер по локали системы — врач с русской Windows, переключивший сайт
 * на турецкий, продолжает слать "ru-RU", поэтому свой заголовок главнее.
 */
export function langOf(req) {
  const explicit = String(req?.headers?.["x-language"] || "")
    .slice(0, 2)
    .toLowerCase();
  if (SUPPORTED.includes(explicit)) return explicit;

  const accept = String(req?.headers?.["accept-language"] || "")
    .split(",")[0]
    .split("-")[0]
    .slice(0, 2)
    .toLowerCase();
  if (SUPPORTED.includes(accept)) return accept;

  return DEFAULT_LANG;
}

/**
 * Текст по коду.
 *
 * @param {string} code     код сообщения, например "patient.notFound"
 * @param {string} lang     язык из langOf(req)
 * @param {object} [params] подстановки вида {{name}}
 * @param {string} [fallback] что показать, если кода нет в словаре
 */
export function t(code, lang, params = {}, fallback = "") {
  const dict = DICTIONARIES[lang] || DICTIONARIES[DEFAULT_LANG];
  let text = dict[code] ?? DICTIONARIES[DEFAULT_LANG][code] ?? fallback ?? code;

  for (const [key, value] of Object.entries(params)) {
    text = text.split(`{{${key}}}`).join(String(value));
  }
  return text;
}

/**
 * Промежуточный слой: кладёт язык и переводчик прямо в запрос.
 *
 * Так контроллеру не нужно ничего импортировать и помнить про заголовки —
 * он просто пишет req.t("код"). Чем меньше ритуала, тем выше шанс, что
 * следующее сообщение тоже напишут кодом, а не строкой.
 */
export function i18nMiddleware(req, res, next) {
  req.lang = langOf(req);
  req.t = (code, params, fallback) => t(code, req.lang, params, fallback);
  next();
}

export default { t, langOf, i18nMiddleware, SUPPORTED };

/**
 * Перевод, не зависящий от того, прошёл ли запрос через прослойку.
 *
 * req.t ставит i18nMiddleware, но контроллеры вызывают не только из
 * маршрутов: так их зовут тесты, обработчики сокетов и задания по
 * расписанию, подсовывая обычный объект вместо запроса. Обращение к
 * несуществующему req.t там роняло бы обработчик — вместо ответа с
 * понятной ошибкой пользователь получал бы 500.
 *
 * Поэтому язык берётся из запроса, если он настоящий, и из языка по
 * умолчанию, если запроса нет.
 */
export function tReq(req, code, params, fallback) {
  return typeof req?.t === "function"
    ? req.t(code, params, fallback)
    : t(code, langOf(req), params, fallback);
}
