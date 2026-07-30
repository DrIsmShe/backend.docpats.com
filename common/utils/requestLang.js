// server/common/utils/requestLang.js
//
// Язык пользователя для одного запроса. Общий на весь проект.
//
// ПОЧЕМУ НЕ ОДНОГО Accept-Language. Этот заголовок браузер ставит сам, из
// локали системы, и JS-код страницы его не переопределяет. Врач с русской
// Windows, переключивший интерфейс на турецкий, продолжал присылать
// "ru-RU,ru;q=0.9" — и получал русский контент в турецком интерфейсе. Причём
// выглядело это как отсутствие перевода, хотя перевод был.
//
// Поэтому первым читается X-Language: его ставит наш клиент из i18n.language,
// то есть из того самого переключателя, которым пользователь выбрал язык.
// Accept-Language остаётся вторым — для запросов не из нашего SPA (curl,
// интеграции, старые сборки клиента).
//
// Неизвестный язык сводим к русскому: на нём пишутся оригиналы.

export const SUPPORTED_LANGS = ["ru", "en", "az", "tr", "ar"];
export const DEFAULT_LANG = "ru";

/** "tr-TR" → "tr", " AZ " → "az". */
function normalize(tag) {
  return String(tag ?? "")
    .trim()
    .slice(0, 2)
    .toLowerCase();
}

/**
 * Язык запроса. Никогда не бросает и всегда возвращает поддерживаемый язык.
 *
 * Accept-Language разбирается по списку, а не по первым двум символам строки:
 * браузер перечисляет языки в порядке предпочтения, и у
 * "de-DE,en;q=0.9,ru;q=0.8" первые два символа — "de", языка, которого у нас
 * нет. Разбор по первым символам сводил такой запрос к русскому, хотя
 * пользователь понимает английский и он в списке есть.
 */
export function langOf(req) {
  const explicit = normalize(req?.headers?.["x-language"]);
  if (SUPPORTED_LANGS.includes(explicit)) return explicit;

  const header = String(req?.headers?.["accept-language"] ?? "");
  for (const part of header.split(",")) {
    const code = normalize(part.split(";")[0]);
    if (SUPPORTED_LANGS.includes(code)) return code;
  }

  return DEFAULT_LANG;
}
