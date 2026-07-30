// server/modules/radiology/translation/requestLang.js
//
// Язык врача для одного запроса. Один источник истины для всех трёх станций.
//
// ПОЧЕМУ НЕ ОДНОГО Accept-Language, КАК БЫЛО. Этот заголовок браузер ставит
// сам, из локали системы, и JS-код страницы его не переопределяет. Врач с
// русской Windows, переключивший интерфейс на турецкий, продолжал присылать
// "ru-RU,ru;q=0.9" — и получал русские кейсы в турецком интерфейсе. Причём
// выглядело это как отсутствие перевода, хотя перевод лежал в базе.
//
// Поэтому первым читается X-Language: его ставит наш клиент из i18n.language,
// то есть из того самого переключателя, которым врач выбрал язык. Accept-
// Language остаётся вторым — для запросов не из нашего SPA (curl, интеграции,
// старые сборки клиента, у которых интерцептора ещё нет).
//
// Неизвестный язык сводим к русскому: кейсы пишутся на нём, и оригинал лучше
// пустого экрана.

export const ARENA_LANGS = ["ru", "en", "az", "tr", "ar"];
export const DEFAULT_LANG = "ru";

/** "tr-TR" → "tr", " AZ " → "az". */
function normalize(tag) {
  return String(tag ?? "")
    .trim()
    .slice(0, 2)
    .toLowerCase();
}

/**
 * Язык врача. Никогда не бросает и всегда возвращает поддерживаемый язык.
 *
 * Accept-Language разбирается по списку, а не по первым двум символам строки:
 * браузер перечисляет языки в порядке предпочтения, и у "de-DE,en;q=0.9,ru;q=0.8"
 * первые два символа — "de", языка, которого у нас нет. Прежний код сводил
 * такой запрос к русскому, хотя врач понимает английский и он в списке есть.
 */
export function langOf(req) {
  const explicit = normalize(req?.headers?.["x-language"]);
  if (ARENA_LANGS.includes(explicit)) return explicit;

  const header = String(req?.headers?.["accept-language"] ?? "");
  for (const part of header.split(",")) {
    const code = normalize(part.split(";")[0]);
    if (ARENA_LANGS.includes(code)) return code;
  }

  return DEFAULT_LANG;
}
