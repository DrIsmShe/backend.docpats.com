// server/modules/radiology/translation/requestLang.js
//
// Язык врача для запросов арены. Разбор общий на весь проект и живёт в
// common/utils/requestLang.js: гид по продукту и арена читают одни и те же
// заголовки, и две копии разбора разошлись бы молча — ровно так уже случилось
// с тремя копиями внутри самой арены.
//
// Здесь остаётся только имя, привычное модулю: ARENA_LANGS совпадает со
// списком языков корпуса, потому что кейсы переводятся на те же пять языков.

export {
  langOf,
  DEFAULT_LANG,
  SUPPORTED_LANGS as ARENA_LANGS,
} from "../../../common/utils/requestLang.js";
