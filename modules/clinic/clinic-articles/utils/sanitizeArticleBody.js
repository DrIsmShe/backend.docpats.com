// server/modules/clinic/clinic-articles/utils/sanitizeArticleBody.js
//
// Санитизация rich-text HTML статей клиники (защита от XSS).
// Статьи — рекламный контент клиник; HTML из CKEditor нельзя доверять.
// Чистим ОДИН РАЗ при сохранении (create/update), не при выводе.
//
// Whitelist подобран под тулбар CKEditor статей: заголовки, форматирование,
// списки, ссылки, картинки, таблицы. Всё прочее (script/iframe/on*-атрибуты,
// javascript:-ссылки, style с expression и т.п.) вырезается.

import sanitizeHtml from "sanitize-html";

const OPTIONS = {
  allowedTags: [
    "p",
    "br",
    "hr",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "b",
    "strong",
    "i",
    "em",
    "u",
    "s",
    "sub",
    "sup",
    "mark",
    "blockquote",
    "pre",
    "code",
    "ul",
    "ol",
    "li",
    "a",
    "img",
    "figure",
    "figcaption",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "th",
    "td",
    "span",
    "div",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height"],
    th: ["colspan", "rowspan", "scope"],
    td: ["colspan", "rowspan"],
    "*": ["class"],
  },
  // только безопасные схемы ссылок/картинок (отсекает javascript:, data:text/html и т.п.)
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: {
    img: ["http", "https"],
  },
  // внешние ссылки — безопасный target
  transformTags: {
    a: (tagName, attribs) => {
      const out = { ...attribs };
      if (out.target === "_blank") {
        out.rel = "noopener noreferrer";
      }
      return { tagName: "a", attribs: out };
    },
  },
  // запрещаем любые inline-стили (вектор для CSS-инъекций) — class разрешён выше
  allowedStyles: {},
  // вырезаем содержимое опасных тегов целиком
  nonTextTags: ["style", "script", "textarea", "option", "noscript"],
};

/**
 * Очистить HTML тела статьи. Возвращает безопасную строку.
 * @param {string} html
 * @returns {string}
 */
export function sanitizeArticleBody(html) {
  if (!html || typeof html !== "string") return "";
  return sanitizeHtml(html, OPTIONS);
}

export default sanitizeArticleBody;
