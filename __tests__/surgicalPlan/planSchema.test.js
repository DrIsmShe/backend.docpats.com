// server/__tests__/surgicalPlan/planSchema.test.js

/* ============================================================
   Схема плана и её перегон в JSON Schema.

   Смысл этих тестов — зафиксировать границу ответственности.
   Схема ловит выдуманные операции и лишние поля; диапазоны
   значений она НЕ гарантирует, потому что конвертер SDK уносит
   их в description. Если однажды это изменится, тест про
   description упадёт — и станет поводом упростить валидатор,
   а не поводом молча его выбросить.
   ============================================================ */

import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it } from "vitest";

import { getCatalog } from "../../modules/surgicalPlan/catalog/index.js";
import { buildPlanSchema } from "../../modules/surgicalPlan/services/planSchema.service.js";

const { catalog } = getCatalog("rhinoplasty_lateral");
const schema = buildPlanSchema(catalog);

const plan = (operations) => ({
  procedure: "rhinoplasty_lateral",
  operations,
  clarifications: [],
  outOfScope: [],
  summary: "s",
});

const op = (over = {}) => ({
  code: "tip_rotation",
  params: { delta_deg: 5 },
  rationale: "r",
  source: "explicit",
  confidence: 0.9,
  ...over,
});

describe("planSchema — разбор ответа модели", () => {
  it("принимает корректный план", () => {
    expect(schema.safeParse(plan([op()])).success).toBe(true);
  });

  it("отвергает операцию не из каталога", () => {
    expect(schema.safeParse(plan([op({ code: "make_nose_pretty" })])).success).toBe(
      false,
    );
  });

  it("отвергает лишний параметр операции", () => {
    const result = schema.safeParse(
      plan([op({ params: { delta_deg: 5, sneaky: 1 } })]),
    );
    expect(result.success).toBe(false);
  });

  it("отвергает параметр от другой операции", () => {
    // Дискриминированное объединение не даёт подставить amount_mm
    // там, где каталог ждёт delta_deg.
    const result = schema.safeParse(plan([op({ params: { amount_mm: 3 } })]));
    expect(result.success).toBe(false);
  });

  it("отвергает лишнее поле верхнего уровня", () => {
    expect(
      schema.safeParse({ ...plan([op()]), extra: true }).success,
    ).toBe(false);
  });

  it("требует все поля — «ничего не нашлось» выражается пустым массивом", () => {
    const { clarifications, ...withoutClarifications } = plan([op()]);
    expect(schema.safeParse(withoutClarifications).success).toBe(false);
    expect(schema.safeParse({ ...withoutClarifications, clarifications: [] }).success).toBe(
      true,
    );
  });
});

describe("planSchema — JSON Schema для structured outputs", () => {
  const format = zodOutputFormat(schema);
  const json = format.schema;

  it("в объединении столько же веток, сколько операций в каталоге", () => {
    expect(json.properties.operations.items.anyOf).toHaveLength(
      catalog.operations.length,
    );
  });

  it("каркас запрещает лишние поля", () => {
    expect(json.additionalProperties).toBe(false);
    expect(json.properties.operations.items.anyOf[0].additionalProperties).toBe(
      false,
    );
  });

  it("границы чисел уезжают в description, а не в ключи схемы", () => {
    // Именно поэтому planValidator перепроверяет диапазоны. Тест
    // сторожит это допущение: изменится поведение SDK — узнаем.
    const rotation = json.properties.operations.items.anyOf.find((branch) =>
      String(branch.properties.code.description || "").includes("tip_rotation"),
    );
    const delta = rotation.properties.params.properties.delta_deg;

    expect(delta.minimum).toBeUndefined();
    expect(delta.maximum).toBeUndefined();
    expect(delta.description).toContain("minimum");
  });
});
