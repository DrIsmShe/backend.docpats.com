// server/__tests__/surgicalPlan/planValidator.test.js

/* ============================================================
   Клиническая валидация плана.

   Это самая ответственная часть модуля: именно её вердикт
   решает, покажем ли врачу результат и какие числа окажутся в
   таблице «до/после». Модель здесь не участвует, поэтому тесты
   детерминированы и сетью не пользуются.
   ============================================================ */

import { describe, expect, it } from "vitest";

import { getCatalog } from "../../modules/surgicalPlan/catalog/index.js";
import { validatePlan } from "../../modules/surgicalPlan/services/planValidator.service.js";

const { catalog, preset } = getCatalog("rhinoplasty_lateral");

// Минимальный валидный план: операции подставляются, остальное — рамка.
const planWith = (operations, extra = {}) => ({
  procedure: "rhinoplasty_lateral",
  operations: operations.map((op) => ({
    rationale: "тест",
    source: "explicit",
    confidence: 0.9,
    ...op,
  })),
  clarifications: [],
  outOfScope: [],
  summary: "тест",
  ...extra,
});

const run = (operations, opts = {}) =>
  validatePlan({
    plan: opts.plan || planWith(operations),
    catalog,
    preset,
    measurements: opts.measurements ?? null,
    patientGender: opts.patientGender ?? "unknown",
  });

const rowFor = (result, code) =>
  result.measurements.rows.find((r) => r.code === code);

const codes = (result, severity) =>
  result.findings.filter((f) => f.severity === severity).map((f) => f.code);

describe("planValidator — предсказание измерений", () => {
  it("identity-эффект складывается с исходным значением", () => {
    const result = run([{ code: "tip_rotation", params: { delta_deg: 8 } }], {
      measurements: { nasolabial_angle: 100 },
      patientGender: "female",
    });

    const row = rowFor(result, "nasolabial_angle");
    expect(row.before).toBe(100);
    expect(row.after).toBe(108);
    expect(row.delta).toBe(8);
    expect(row.kind).toBe("quantified");
    expect(result.ok).toBe(true);
  });

  it("без измерений «до» дельта известна, а абсолютные значения — нет", () => {
    // Ради этого случая эффекты и разделены на три вида: калибровки
    // может не быть, но «+8°» остаётся правдой независимо от неё.
    const result = run([{ code: "tip_rotation", params: { delta_deg: 8 } }]);

    const row = rowFor(result, "nasolabial_angle");
    expect(row.delta).toBe(8);
    expect(row.before).toBeNull();
    expect(row.after).toBeNull();
    expect(result.ok).toBe(true);
  });

  it("качественный эффект даёт направление и НЕ даёт числа", () => {
    // Коэффициент «сколько градусов на миллиметр резекции» зависит от
    // анатомии и техники. Выдуманное число хуже честной стрелки.
    const result = run(
      [{ code: "dorsal_hump_reduction", params: { amount_mm: 3 } }],
      { measurements: { nasofrontal_angle: 120 } },
    );

    const row = rowFor(result, "nasofrontal_angle");
    expect(row.kind).toBe("directional");
    expect(row.direction).toBe("increase");
    expect(row.delta).toBeNull();
    expect(row.after).toBeNull();
    expect(row.before).toBe(120);
  });

  it("производное измерение пересчитывается из предсказанных слагаемых", () => {
    const result = run(
      [{ code: "tip_projection_change", params: { delta_mm: -6 } }],
      { measurements: { tip_projection: 28, nasal_length: 48 } },
    );

    const goode = rowFor(result, "goode_ratio");
    // 22 / 48 = 0.4583…
    expect(goode.after).toBeCloseTo(0.46, 2);
    expect(goode.before).toBeCloseTo(0.58, 2);
  });

  it("два эффекта на одно измерение складываются", () => {
    const result = run(
      [
        { code: "tip_rotation", params: { delta_deg: 6 } },
        { code: "columellar_show_correction", params: { delta_mm: 2 } },
      ],
      { measurements: { nasolabial_angle: 95 }, patientGender: "female" },
    );

    // tip_rotation даёт identity +6; columellar_show_correction —
    // только направление, поэтому число меняется ровно на 6.
    expect(rowFor(result, "nasolabial_angle").after).toBe(101);
  });
});

describe("planValidator — нормы", () => {
  it("выход из нормы помечается предупреждением", () => {
    const result = run([{ code: "tip_rotation", params: { delta_deg: 15 } }], {
      measurements: { nasolabial_angle: 100 },
      patientGender: "female", // норма 95–110
    });

    expect(codes(result, "warning")).toContain("LEAVES_NORM");
    // Предупреждение не блокирует: врач вправе так решить, но обязан увидеть.
    expect(result.ok).toBe(true);
  });

  it("возвращение в норму помечается как info", () => {
    const result = run([{ code: "tip_rotation", params: { delta_deg: 10 } }], {
      measurements: { nasolabial_angle: 88 },
      patientGender: "female",
    });

    expect(codes(result, "info")).toContain("ENTERS_NORM");
  });

  it("норма выбирается по полу пациента", () => {
    const measurements = { nasolabial_angle: 104 };

    // 104 + 4 = 108: для женской нормы 95–110 это внутри,
    // для мужской 90–105 — выход за верхнюю границу.
    const female = run([{ code: "tip_rotation", params: { delta_deg: 4 } }], {
      measurements,
      patientGender: "female",
    });
    const male = run([{ code: "tip_rotation", params: { delta_deg: 4 } }], {
      measurements,
      patientGender: "male",
    });

    expect(codes(female, "warning")).not.toContain("LEAVES_NORM");
    expect(codes(male, "warning")).toContain("LEAVES_NORM");
  });

  it("физически невозможный результат — ошибка, а не предупреждение", () => {
    const result = run(
      [{ code: "tip_projection_change", params: { delta_mm: -6 } }],
      { measurements: { tip_projection: 5 } },
    );

    expect(codes(result, "error")).toContain("IMPOSSIBLE_RESULT");
    expect(result.ok).toBe(false);
  });
});

describe("planValidator — структура плана", () => {
  it("параметр вне границ каталога — ошибка", () => {
    // Схема такие числа не ловит: API получает границы текстом в
    // description, а не проверяемым ключом. Эта проверка — не дубль.
    const result = run([{ code: "tip_rotation", params: { delta_deg: 50 } }]);

    expect(codes(result, "error")).toContain("PARAM_OUT_OF_RANGE");
    expect(result.ok).toBe(false);
  });

  it("несовместимые операции — ошибка", () => {
    const result = run([
      { code: "dorsal_hump_reduction", params: { amount_mm: 2 } },
      { code: "dorsal_augmentation", params: { amount_mm: 2 } },
    ]);

    expect(codes(result, "error")).toContain("CONFLICTING_OPERATIONS");
  });

  it("одна операция дважды — ошибка", () => {
    const result = run([
      { code: "tip_rotation", params: { delta_deg: 4 } },
      { code: "tip_rotation", params: { delta_deg: 2 } },
    ]);

    expect(codes(result, "error")).toContain("DUPLICATE_OPERATION");
  });

  it("операция не из каталога — ошибка", () => {
    const result = run([{ code: "make_nose_pretty", params: {} }]);

    expect(codes(result, "error")).toContain("UNKNOWN_OPERATION");
  });

  it("отсутствующий обязательный параметр — ошибка", () => {
    const result = run([{ code: "tip_rotation", params: {} }]);

    expect(codes(result, "error")).toContain("MISSING_PARAM");
  });

  it("значение вне enum — ошибка", () => {
    const result = run([
      { code: "supratip_break_definition", params: { intensity: "extreme" } },
    ]);

    expect(codes(result, "error")).toContain("PARAM_NOT_IN_ENUM");
  });

  it("блокирующий вопрос не даёт признать план исполнимым", () => {
    // Нарисовать по недопонятому плану хуже, чем не нарисовать.
    const plan = planWith([{ code: "tip_rotation", params: { delta_deg: 5 } }], {
      clarifications: [
        { question: "Насколько приподнять?", why: "величина не названа", blocking: true },
      ],
    });

    const result = validatePlan({ plan, catalog, preset });

    expect(result.ok).toBe(false);
    expect(codes(result, "error")).toContain("BLOCKING_CLARIFICATION");
  });

  it("неблокирующий вопрос плану не мешает", () => {
    const plan = planWith([{ code: "tip_rotation", params: { delta_deg: 5 } }], {
      clarifications: [
        { question: "Уточните величину", why: "выведено из формулировки", blocking: false },
      ],
    });

    expect(validatePlan({ plan, catalog, preset }).ok).toBe(true);
  });

  it("пустой план не считается исполнимым", () => {
    // Живой случай: просьбу вне каталога («сузить крылья» в боковой
    // проекции) разбор уносит в outOfScope, операций не остаётся.
    // Признать такое ok — значит отрисовать исходник как результат.
    const result = run([]);

    expect(result.ok).toBe(false);
    expect(codes(result, "error")).toContain("EMPTY_PLAN");
    expect(result.measurements.rows).toHaveLength(0);
    expect(result.measurements.after).toBeNull();
  });
});
