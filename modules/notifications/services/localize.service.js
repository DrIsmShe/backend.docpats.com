// server/modules/notifications/services/localize.service.js
//
// Сборка текста уведомления на языке того, кто его читает.
//
// ЗАЧЕМ. Уведомление создаётся в одном запросе, а читается в другом —
// иногда через месяцы и почти всегда другим человеком. Пациент записался
// с турецким интерфейсом, уведомление получил врач с азербайджанским, а
// текст в базу лёг русский, потому что так его написал разработчик.
// Готовая фраза в записи означает, что язык уведомления навсегда равен
// языку того, кто его вызвал, а не того, кому оно адресовано.
//
// Поэтому в базе лежит код словаря и значения подстановок, а фраза
// собирается здесь, в момент чтения.
//
// ЧЕГО ЗДЕСЬ НЕТ. Записи без кода не трогаются вовсе: у всего, что
// накопилось до этого, есть только готовый русский текст, и заменить его
// нечем. Такое уведомление остаётся русским — это лучше, чем пустое.

import { t, langOf } from "../../../common/i18n/index.js";

// Отличаем дату от обычной строки: значение вида 2026-08-31T12:00:00.000Z.
// Проверка строгая намеренно — «2026» или «31.08.2026» под неё не попадут
// и останутся текстом, каким их и передали.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const LOCALES = {
  ru: "ru-RU",
  en: "en-GB",
  az: "az-AZ",
  tr: "tr-TR",
  ar: "ar-EG",
};

/**
 * Значения подстановок в вид, годный для показа.
 *
 * Даты в базе лежат машинно (ISO) — иначе «31 августа в 14:00» осталось бы
 * русским в любом переводе. Здесь они превращаются в дату на языке
 * читающего. Всё остальное — имена, названия, числа — уходит как есть.
 */
function displayParams(params, lang) {
  const out = {};
  for (const [key, value] of Object.entries(params || {})) {
    if (typeof value === "string" && ISO_DATE.test(value)) {
      const d = new Date(value);
      out[key] = Number.isNaN(d.getTime())
        ? value
        : d.toLocaleString(LOCALES[lang] || LOCALES.ru, {
            day: "numeric",
            month: "long",
            hour: "2-digit",
            minute: "2-digit",
          });
      continue;
    }
    // Значение, которое само является кодом словаря. Так переводятся
    // подставляемые ярлыки: вид заявки, статус приёма. Иначе внутри
    // турецкой фразы стояло бы русское слово — подстановка идёт значением,
    // а значение выбирает вызывающий, не знающий языка читателя.
    if (typeof value === "string" && value.startsWith("app.")) {
      out[key] = t(value, lang, {}, value);
      continue;
    }

    out[key] = value;
  }
  return out;
}

/**
 * Заголовок и текст уведомления на заданном языке.
 *
 * Отдельно от localizeNotification, потому что зовётся из двух разных
 * мест с разным источником языка. При чтении список собирается на языке
 * запроса. А браузерное уведомление уходит в момент создания, когда
 * читателя ещё нет за экраном: там язык берётся из его профиля.
 */
export function renderNotification({ i18n, title, message }, lang) {
  if (!i18n?.title && !i18n?.message) return { title, message };
  const params = displayParams(i18n.params, lang);
  return {
    title: i18n.title ? t(i18n.title, lang, params, title) : title,
    message: i18n.message ? t(i18n.message, lang, params, message) : message,
  };
}

/**
 * Одно уведомление с текстом на языке запроса.
 *
 * Принимает и документ mongoose, и результат .lean(). Возвращает простой
 * объект: возвращать документ нельзя — подменённые поля ушли бы в базу
 * при случайном save().
 */
export function localizeNotification(doc, req) {
  if (!doc) return doc;
  const plain = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  const codes = plain.i18n;
  if (!codes?.title && !codes?.message) return plain;

  const lang = req?.lang || langOf(req);
  const { title, message } = renderNotification(plain, lang);
  plain.title = title;
  plain.message = message;
  return plain;
}

/** То же для списка. */
export function localizeNotifications(list, req) {
  if (!Array.isArray(list)) return list;
  return list.map((n) => localizeNotification(n, req));
}
