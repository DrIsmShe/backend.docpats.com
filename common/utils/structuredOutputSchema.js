// server/common/utils/structuredOutputSchema.js
//
// Приведение JSON-схемы к тому подмножеству, которое принимает structured
// outputs Anthropic API.
//
// ЗАЧЕМ ЭТОТ ФАЙЛ СУЩЕСТВУЕТ. Схема со словом `maxItems` уходила в
// output_config.format.schema и получала 400:
//
//   output_config.format.schema: For 'array' type, property 'maxItems' is not
//   supported
//
// Само по себе это мелочь. Плохо то, КОГДА это выясняется: схема — константа,
// она не меняется от данных, поэтому запрос падал не иногда, а всегда, и не у
// разработчика, а у врача, нажавшего «Разобрать материалы». Ни один тест этого
// не ловил: мы мокаем клиента, а значит проверяем свой код, а не то, что API
// согласен принять схему.
//
// Отсюда два разных средства, и оба нужны:
//   • здесь — снятие неподдерживаемых ключей перед отправкой, чтобы забытый
//     ключ никогда не превращался в отказ в работе врача;
//   • в тестах — проверка, что наши схемы чистые изначально, чтобы это
//     средство оставалось страховкой, а не постоянным костылём.
//
// Список составлен пробой по живому API (июль 2026), а не догадками:
//   отклоняются  array.maxItems, array.uniqueItems, number.minimum,
//                number.maximum, array.minItems со значением больше 1
//   принимаются  array.minItems (0 или 1), string.maxLength/minLength/
//                pattern/format, enum, description, additionalProperties,
//                required
//
// Ограничения, которые здесь снимаются, всё равно должны соблюдаться — но
// нашим кодом после разбора ответа (normalize*-функции обрезают списки), а не
// схемой. Модель и так следует описанию в description; схема лишь не может это
// проверить.

/** Ключи, которые API отвергает всегда, — по типу узла. */
export const UNSUPPORTED_BY_TYPE = {
  array: ["maxItems", "uniqueItems"],
  number: ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"],
  integer: ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"],
};

/**
 * Ключи, недопустимые ПРИ НЕКОТОРЫХ значениях.
 *
 * minItems принимается только со значением 0 или 1: «хотя бы один элемент»
 * выразить можно, «хотя бы четыре» — уже нет. Проверять здесь надо значение, а
 * не наличие ключа, иначе защита либо пропустит minItems: 4 (и мы снова
 * получим 400), либо снимет безобидный minItems: 1.
 */
const CONDITIONAL = {
  array: {
    minItems: (v) => v !== 0 && v !== 1,
  },
};

/** Какие ключи снять с этого узла с учётом их значений. */
function unsupportedFor(node) {
  const type = node?.type;
  const always = UNSUPPORTED_BY_TYPE[type] ?? [];
  const rules = CONDITIONAL[type] ?? {};
  const conditional = Object.keys(rules).filter(
    (key) => key in (node ?? {}) && rules[key](node[key]),
  );
  return [...always, ...conditional];
}

/**
 * Где в схеме встречаются неподдерживаемые ключи.
 *
 * Возвращает пути вида "properties.findings.maxItems" — по ним видно, что
 * именно чинить в исходной схеме. Используется тестами.
 *
 * @param {object} schema
 * @param {string} [path]
 * @returns {string[]}
 */
export function findUnsupportedKeywords(schema, path = "") {
  if (!schema || typeof schema !== "object") return [];
  const found = [];

  for (const key of unsupportedFor(schema)) {
    if (key in schema) found.push(path ? `${path}.${key}` : key);
  }

  // Рекурсия по всем местам, где может лежать вложенная схема. Список веток
  // явный: пройтись по всем ключам подряд нельзя — description и enum тоже
  // объекты/массивы, и мы бы искали ключевые слова в данных.
  const at = (sub, name) => (path ? `${path}.${name}` : name);

  if (schema.properties && typeof schema.properties === "object") {
    for (const [name, sub] of Object.entries(schema.properties)) {
      found.push(...findUnsupportedKeywords(sub, at(sub, `properties.${name}`)));
    }
  }
  if (schema.items) {
    if (Array.isArray(schema.items)) {
      schema.items.forEach((sub, i) =>
        found.push(...findUnsupportedKeywords(sub, at(sub, `items[${i}]`))),
      );
    } else {
      found.push(...findUnsupportedKeywords(schema.items, at(schema.items, "items")));
    }
  }
  for (const branch of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(schema[branch])) {
      schema[branch].forEach((sub, i) =>
        found.push(...findUnsupportedKeywords(sub, at(sub, `${branch}[${i}]`))),
      );
    }
  }
  if (schema.$defs && typeof schema.$defs === "object") {
    for (const [name, sub] of Object.entries(schema.$defs)) {
      found.push(...findUnsupportedKeywords(sub, at(sub, `$defs.${name}`)));
    }
  }

  return found;
}

/**
 * Копия схемы без неподдерживаемых ключей. Исходная схема не меняется:
 * она общая на весь процесс, и портить её нельзя.
 *
 * @param {object} schema
 * @returns {object}
 */
export function stripUnsupportedKeywords(schema) {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(stripUnsupportedKeywords);

  const drop = new Set(unsupportedFor(schema));
  const out = {};

  for (const [key, value] of Object.entries(schema)) {
    if (drop.has(key)) continue;

    if (key === "properties" && value && typeof value === "object") {
      out.properties = Object.fromEntries(
        Object.entries(value).map(([n, sub]) => [n, stripUnsupportedKeywords(sub)]),
      );
    } else if (key === "$defs" && value && typeof value === "object") {
      out.$defs = Object.fromEntries(
        Object.entries(value).map(([n, sub]) => [n, stripUnsupportedKeywords(sub)]),
      );
    } else if (key === "items" || key === "anyOf" || key === "oneOf" || key === "allOf") {
      out[key] = Array.isArray(value)
        ? value.map(stripUnsupportedKeywords)
        : stripUnsupportedKeywords(value);
    } else {
      out[key] = value;
    }
  }

  return out;
}

/**
 * Схема, готовая к отправке. Если что-то снято — предупреждение в лог: тихая
 * правка схемы означала бы, что ограничение исчезло и никто не заметил.
 *
 * @param {object} schema
 * @param {{warn?: Function}} [logger]
 * @param {string} [what] — для сообщения в логе
 */
export function prepareSchema(schema, logger, what = "schema") {
  const problems = findUnsupportedKeywords(schema);
  if (!problems.length) return schema;

  logger?.warn?.(
    { unsupported: problems, what },
    "structured outputs: из схемы сняты ключи, которые API не принимает — ограничение должен соблюдать код разбора ответа",
  );
  return stripUnsupportedKeywords(schema);
}
