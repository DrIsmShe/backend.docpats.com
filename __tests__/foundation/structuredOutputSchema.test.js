// __tests__/foundation/structuredOutputSchema.test.js
//
// Схемы structured outputs: соответствие подмножеству, которое принимает API.
//
// Тест написан по факту production-отказа. В схеме разбора материалов стоял
// `maxItems: 12`, и КАЖДЫЙ запрос падал с 400:
//
//   output_config.format.schema: For 'array' type, property 'maxItems' is not
//   supported
//
// Схема — константа. Значит, отказ был не случайным и не редким: разбор не
// работал вообще ни разу. И увидел это врач, а не мы: тесты мокают клиента,
// поэтому проверяют наш код, но не то, согласен ли API принять схему.
//
// Здесь два уровня проверки:
//   1. РЕАЛЬНЫЕ схемы модулей не содержат запрещённых ключей. Это главное:
//      защита в runner'ах должна оставаться страховкой, а не подпоркой.
//   2. Сама защита снимает то, что нужно, и не трогает то, что можно.

import { describe, it, expect, vi } from "vitest";

import {
  findUnsupportedKeywords,
  stripUnsupportedKeywords,
  prepareSchema,
} from "../../common/utils/structuredOutputSchema.js";

/* ─── 1. Реальные схемы проекта ───────────────────────────────────────── */

// Здесь перечислены ВСЕ схемы, которые уходят в output_config.format.schema.
// Добавили новую и не вписали сюда — она не проверяется; поэтому ниже стоит
// счётчик, который падает, если список внезапно похудел.
const { FINDINGS_SCHEMA } = await import("../../modules/diagnostics/ai/findings.schema.js");
const { LAB_SCHEMA, VP_SCHEMA } = await import("../../modules/radiology/ai/caseVariants.js");
const { DRAFT_SCHEMA, ANALYSIS_SCHEMA } = await import("../../modules/radiology/ai/aiDrafter.js");
const { GENERATION_JSON_SCHEMA } = await import(
  "../../modules/education/education-ingest/extractors/generate.schema.js"
);
const { EXTRACTION_JSON_SCHEMA } = await import(
  "../../modules/education/education-ingest/extractors/extraction.schema.js"
);

describe("схемы модулей приняты API", () => {
  const schemas = [
    ["diagnostics: выводы разбора", FINDINGS_SCHEMA],
    ["radiology: варианты лабораторного кейса", LAB_SCHEMA],
    ["radiology: варианты сценария", VP_SCHEMA],
    ["radiology: черновик кейса по снимку", DRAFT_SCHEMA],
    ["radiology: разбор попытки", ANALYSIS_SCHEMA],
    ["education: генерация вопросов", GENERATION_JSON_SCHEMA],
    ["education: извлечение из материала", EXTRACTION_JSON_SCHEMA],
  ];

  it.each(schemas)("%s — без запрещённых ключей", (_name, schema) => {
    expect(schema, "схема не импортировалась").toBeTruthy();
    // Сообщение специально включает пути: при падении сразу видно, что чинить.
    expect(findUnsupportedKeywords(schema)).toEqual([]);
  });

  it("проверены все известные схемы, а не подмножество", () => {
    // Страховка от тихого сокращения списка: без неё удалённый импорт
    // превратился бы в «тестов стало меньше», а не в падение.
    expect(schemas).toHaveLength(7);
  });
});

/* ─── 2. Поведение самой защиты ───────────────────────────────────────── */

describe("поиск запрещённых ключей", () => {
  it("находит maxItems в глубине схемы и показывает путь", () => {
    const schema = {
      type: "object",
      properties: {
        findings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              tags: { type: "array", maxItems: 3, items: { type: "string" } },
            },
          },
        },
      },
    };
    expect(findUnsupportedKeywords(schema)).toEqual([
      "properties.findings.items.properties.tags.maxItems",
    ]);
  });

  it("minItems 0 и 1 разрешены, остальные значения — нет", () => {
    const ok = { type: "array", minItems: 1, items: { type: "string" } };
    const bad = { type: "array", minItems: 4, items: { type: "string" } };
    expect(findUnsupportedKeywords(ok)).toEqual([]);
    expect(findUnsupportedKeywords(bad)).toEqual(["minItems"]);
  });

  it("границы чисел запрещены", () => {
    const schema = {
      type: "object",
      properties: { score: { type: "number", minimum: 0, maximum: 1 } },
    };
    expect(findUnsupportedKeywords(schema)).toEqual([
      "properties.score.minimum",
      "properties.score.maximum",
    ]);
  });

  it("строковые ограничения и enum не считаются запрещёнными", () => {
    const schema = {
      type: "object",
      properties: {
        code: { type: "string", maxLength: 10, minLength: 1, pattern: "^[A-Z]+$" },
        level: { type: "string", enum: ["low", "high"] },
      },
    };
    expect(findUnsupportedKeywords(schema)).toEqual([]);
  });

  it("не принимает описания за схему", () => {
    // description и enum — это данные. Наивный обход всех ключей подряд искал
    // бы ключевые слова внутри них и находил бы несуществующие проблемы.
    const schema = {
      type: "object",
      properties: {
        note: { type: "string", description: "укажите maxItems, если нужно" },
        kind: { type: "string", enum: ["maxItems", "minimum"] },
      },
    };
    expect(findUnsupportedKeywords(schema)).toEqual([]);
  });
});

describe("очистка схемы", () => {
  const dirty = {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
      items: {
        type: "array",
        maxItems: 5,
        minItems: 1,
        description: "список",
        items: { type: "string", maxLength: 40 },
      },
      score: { type: "number", minimum: 0 },
    },
  };

  it("снимает запрещённое и сохраняет остальное", () => {
    const clean = stripUnsupportedKeywords(dirty);
    expect(clean.properties.items.maxItems).toBeUndefined();
    expect(clean.properties.score.minimum).toBeUndefined();

    expect(clean.properties.items.minItems).toBe(1); // разрешено
    expect(clean.properties.items.description).toBe("список");
    expect(clean.properties.items.items.maxLength).toBe(40);
    expect(clean.additionalProperties).toBe(false);
    expect(clean.required).toEqual(["items"]);
  });

  it("исходную схему не портит — она общая на весь процесс", () => {
    stripUnsupportedKeywords(dirty);
    expect(dirty.properties.items.maxItems).toBe(5);
  });

  it("результат очистки уже чист", () => {
    expect(findUnsupportedKeywords(stripUnsupportedKeywords(dirty))).toEqual([]);
  });
});

describe("подготовка к отправке", () => {
  it("чистую схему отдаёт как есть и молчит", () => {
    const logger = { warn: vi.fn() };
    const schema = { type: "object", properties: { a: { type: "string" } } };
    expect(prepareSchema(schema, logger)).toBe(schema);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("грязную чистит и предупреждает — снятое ограничение не должно исчезать молча", () => {
    const logger = { warn: vi.fn() };
    const schema = {
      type: "object",
      properties: { list: { type: "array", maxItems: 2, items: { type: "string" } } },
    };
    const out = prepareSchema(schema, logger, "разбор");
    expect(out.properties.list.maxItems).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn.mock.calls[0][0].unsupported).toContain("properties.list.maxItems");
  });

  it("работает без логгера", () => {
    const schema = { type: "array", maxItems: 2, items: { type: "string" } };
    expect(() => prepareSchema(schema)).not.toThrow();
  });
});
