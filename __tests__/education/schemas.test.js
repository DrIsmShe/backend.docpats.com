// __tests__/education/schemas.test.js
//
// Сторож над JSON-схемами structured outputs.
//
// Ограничения Anthropic structured outputs проверяются не при сборке, а при
// первом же запросе: неподдерживаемое ключевое слово в схеме отвергается
// целиком с 400, и падает КАЖДЫЙ вызов экстрактора. Генерация вопросов так
// и не работала ни разу из-за minItems: 4 / maxItems: 5 у options — в
// интерфейсе это выглядело как «модель не сгенерировала ни одного вопроса».
//
// Правило записано в шапке extraction.schema.js, но комментарий не мешает
// добавить ограничение в соседний файл — поэтому проверяем обе схемы кодом.

import { describe, it, expect } from "vitest";
import { EXTRACTION_JSON_SCHEMA } from "../../modules/education/education-ingest/extractors/extraction.schema.js";
import { GENERATION_JSON_SCHEMA } from "../../modules/education/education-ingest/extractors/generate.schema.js";

// Числовые и строковые ограничения structured outputs не понимает.
// minItems допускается только со значением 0 или 1.
const FORBIDDEN = [
  "maxItems",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "uniqueItems",
];

// Собирает все нарушения с путём до узла — чтобы сообщение теста сразу
// показывало, что и где править.
function findViolations(node, path = "$") {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) {
    return node.flatMap((item, i) => findViolations(item, `${path}[${i}]`));
  }

  const found = [];
  for (const key of FORBIDDEN) {
    if (key in node) found.push(`${path}.${key} = ${JSON.stringify(node[key])}`);
  }
  if ("minItems" in node && ![0, 1].includes(node.minItems)) {
    found.push(`${path}.minItems = ${node.minItems} (допустимы только 0 и 1)`);
  }

  for (const [key, value] of Object.entries(node)) {
    found.push(...findViolations(value, `${path}.${key}`));
  }
  return found;
}

describe("JSON-схемы экстракторов", () => {
  it.each([
    ["извлечение из файла", EXTRACTION_JSON_SCHEMA],
    ["генерация по теме", GENERATION_JSON_SCHEMA],
  ])("%s: без ограничений, которые отвергает API", (_name, schema) => {
    expect(findViolations(schema)).toEqual([]);
  });

  it.each([
    ["извлечение из файла", EXTRACTION_JSON_SCHEMA],
    ["генерация по теме", GENERATION_JSON_SCHEMA],
  ])("%s: у каждого объекта есть additionalProperties: false", (_name, schema) => {
    const missing = [];
    const walk = (node, path = "$") => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach((item, i) => walk(item, `${path}[${i}]`));
        return;
      }
      if (node.type === "object" && node.additionalProperties !== false) {
        missing.push(path);
      }
      for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`);
    };
    walk(schema);
    expect(missing).toEqual([]);
  });

  // Сам сторож должен ловить именно ту ошибку, из-за которой он появился.
  it("ловит minItems: 4 — ту самую поломку генерации", () => {
    const broken = {
      type: "object",
      additionalProperties: false,
      properties: { options: { type: "array", minItems: 4, maxItems: 5 } },
    };
    expect(findViolations(broken)).toHaveLength(2);
  });
});
