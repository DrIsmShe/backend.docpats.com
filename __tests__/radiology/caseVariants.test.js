// __tests__/radiology/caseVariants.test.js
//
// Числовые варианты кейса: тот же диагноз, другие значения.
//
// Смысл: ответ на конкретный кейс легко передать словами — «там значимы
// гемоглобин и ферритин». Если у соседа другие цифры, пересказ не помогает, а
// повторный зачёт перестаёт быть тем же текстом.
//
// Что здесь важно проверить:
//   • вариант выбирается ДЕТЕРМИНИРОВАННО по номеру попытки (иначе оценку
//     нельзя пересчитать спустя месяц) и идёт по кругу, начиная с базового;
//   • оценка считается по значимым отклонениям ТОГО варианта, который видел
//     врач, — иначе правильный ответ был бы наказан;
//   • вариант меняет только значения: чужие ключи и попытка подменить
//     структуру отбрасываются нормализацией;
//   • эталон варианта не утекает учащемуся.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import LabCase from "../../modules/radiology/labs-station/models/labCase.model.js";
import {
  startLabAttempt,
  submitLabAttempt,
  sanitizeLabForLearner,
  listLabCases,
} from "../../modules/radiology/labs-station/lab.service.js";
import {
  pickVariantIndex,
  applyLabVariant,
  applyVpVariant,
  variantLabelOf,
} from "../../modules/radiology/radiology-attempts/services/variantPicker.js";
import {
  normalizeLabVariants,
  normalizeVpVariants,
} from "../../modules/radiology/ai/caseVariants.js";
import { COOLDOWN_MS } from "../../modules/radiology/radiology-attempts/services/attemptPolicy.js";
import LabAttempt from "../../modules/radiology/labs-station/models/labAttempt.model.js";

const userId = new mongoose.Types.ObjectId();

// Базовый кейс: значима анемия. Вариант «Б»: гемоглобин в норме, значим
// только ферритин (латентный дефицит железа) — другой правильный ответ.
async function makeCaseWithVariants() {
  return LabCase.create({
    title: "Дефицит железа",
    panel: [
      { key: "hgb", name: "Гемоглобин", value: "88", unit: "г/л", refRange: "120–150" },
      { key: "ferritin", name: "Ферритин", value: "4", unit: "мкг/л", refRange: "15–150" },
      { key: "plt", name: "Тромбоциты", value: "290", unit: "10⁹/л", refRange: "150–400" },
    ],
    significantAbnormal: ["hgb", "ferritin"],
    impression: {
      correctText: "Железодефицит",
      diagnosisKeys: ["железодефицитная анемия", "латентный дефицит железа"],
    },
    variants: [
      {
        label: "Вариант Б",
        panel: [
          { key: "hgb", value: "131", unit: "г/л", refRange: "120–150" },
          { key: "ferritin", value: "6", unit: "мкг/л", refRange: "15–150" },
        ],
        significantAbnormal: ["ferritin"],
        note: "Латентный дефицит: гемоглобин ещё в норме",
      },
    ],
    source: { kind: "original" },
    status: "published",
  });
}

let labCase;
beforeEach(async () => {
  labCase = await makeCaseWithVariants();
});

describe("выбор варианта", () => {
  it("без вариантов всегда базовый кейс", () => {
    expect(pickVariantIndex(1, 0)).toBe(0);
    expect(pickVariantIndex(7, 0)).toBe(0);
  });

  it("идёт по кругу, начиная с базового", () => {
    // Один вариант → чередование базовый / вариант.
    expect(pickVariantIndex(1, 1)).toBe(0);
    expect(pickVariantIndex(2, 1)).toBe(1);
    expect(pickVariantIndex(3, 1)).toBe(0);
    // Два варианта → базовый, первый, второй, снова базовый.
    expect([1, 2, 3, 4].map((n) => pickVariantIndex(n, 2))).toEqual([0, 1, 2, 0]);
  });

  it("детерминирован: тот же номер попытки — тот же вариант", () => {
    expect(pickVariantIndex(5, 3)).toBe(pickVariantIndex(5, 3));
  });

  it("подпись варианта берётся у автора, а иначе подставляется номер", () => {
    expect(variantLabelOf(labCase, 1)).toBe("Вариант Б");
    expect(variantLabelOf({ variants: [{}] }, 1)).toBe("Вариант 1");
    expect(variantLabelOf(labCase, 0)).toBe("");
  });
});

describe("наложение варианта", () => {
  it("значения меняются, а названия и ключи остаются от кейса", () => {
    const { panel, significantAbnormal, variantLabel } = applyLabVariant(labCase, 1);
    expect(panel.map((p) => p.value)).toEqual(["131", "6", "290"]);
    expect(panel.map((p) => p.name)).toEqual(["Гемоглобин", "Ферритин", "Тромбоциты"]);
    expect(significantAbnormal).toEqual(["ferritin"]);
    expect(variantLabel).toBe("Вариант Б");
  });

  it("показатель, которого нет в варианте, остаётся из базового кейса", () => {
    const { panel } = applyLabVariant(labCase, 1);
    // Тромбоциты вариант не менял.
    expect(panel.find((p) => p.key === "plt").value).toBe("290");
  });

  it("индекс 0 и несуществующий индекс дают базовый кейс", () => {
    for (const idx of [0, 5, 99]) {
      const { panel, significantAbnormal } = applyLabVariant(labCase, idx);
      expect(panel[0].value).toBe("88");
      expect(significantAbnormal).toEqual(["hgb", "ferritin"]);
    }
  });

  it("вариант без своих значимых отклонений наследует эталон кейса", () => {
    const doc = { ...labCase.toObject(), variants: [{ label: "В", panel: [{ key: "hgb", value: "90" }] }] };
    expect(applyLabVariant(doc, 1).significantAbnormal).toEqual(["hgb", "ferritin"]);
  });

  it("сценарий VP: жалоба и результаты из варианта, набор обследований тот же", () => {
    const vpDoc = {
      presentation: "Женщина 28 лет",
      investigations: [
        { key: "rf", name: "РФ", resultText: "положительный", necessary: true },
        { key: "xray", name: "Рентген", resultText: "эрозии", necessary: true },
      ],
      variants: [
        {
          label: "Мужчина 44",
          presentation: "Мужчина 44 лет",
          results: [{ key: "rf", resultText: "резко положительный" }],
        },
      ],
    };
    const { presentation, investigations } = applyVpVariant(vpDoc, 1);
    expect(presentation).toBe("Мужчина 44 лет");
    expect(investigations.find((i) => i.key === "rf").resultText).toBe("резко положительный");
    // Не тронуто: и текст, и пометка «нужное».
    expect(investigations.find((i) => i.key === "xray").resultText).toBe("эрозии");
    expect(investigations.every((i) => i.necessary)).toBe(true);
  });
});

describe("прохождение с вариантом", () => {
  it("первая попытка — базовый кейс, вторая — вариант", async () => {
    const first = await startLabAttempt(labCase._id, userId, "learn");
    expect(first.attempt.variantIndex).toBe(0);
    expect(first.case.panel[0].value).toBe("88");
    expect(first.case.variantCount).toBe(1);
    await submitLabAttempt(first.attempt._id, userId, { flags: ["hgb", "ferritin"] });

    const second = await startLabAttempt(labCase._id, userId, "learn");
    expect(second.attempt.variantIndex).toBe(1);
    expect(second.attempt.variantLabel).toBe("Вариант Б");
    expect(second.case.panel[0].value).toBe("131");
    expect(second.case.variantLabel).toBe("Вариант Б");
  });

  it("оценка считается по эталону выданного варианта", async () => {
    // Проходим первую попытку, чтобы вторая досталась варианту Б.
    const first = await startLabAttempt(labCase._id, userId, "learn");
    await submitLabAttempt(first.attempt._id, userId, { flags: [] });

    const second = await startLabAttempt(labCase._id, userId, "learn");
    expect(second.attempt.variantIndex).toBe(1);

    // В варианте Б гемоглобин в норме: правильный ответ — только ферритин.
    const right = await submitLabAttempt(second.attempt._id, userId, {
      flags: ["ferritin"],
      diagnosisText: "Латентный дефицит железа",
    });
    expect(right.attempt.score.detection).toBe(1);
    expect(right.review.variantLabel).toBe("Вариант Б");
    expect(right.review.significantAbnormal.map((s) => s.key)).toEqual(["ferritin"]);
  });

  it("ответ по базовому эталону в варианте уже неверен", async () => {
    const first = await startLabAttempt(labCase._id, userId, "learn");
    await submitLabAttempt(first.attempt._id, userId, { flags: [] });
    const second = await startLabAttempt(labCase._id, userId, "learn");

    // «Как в том кейсе у коллеги»: гемоглобин + ферритин. В варианте Б
    // гемоглобин 131 — это ложная отметка.
    const res = await submitLabAttempt(second.attempt._id, userId, {
      flags: ["hgb", "ferritin"],
    });
    expect(res.attempt.falsePositives).toBe(1);
    expect(res.attempt.score.detection).toBeLessThan(1);
  });

  it("продолжение незакрытой попытки отдаёт тот же вариант", async () => {
    const first = await startLabAttempt(labCase._id, userId, "learn");
    await submitLabAttempt(first.attempt._id, userId, { flags: [] });
    const second = await startLabAttempt(labCase._id, userId, "learn");
    const resumed = await startLabAttempt(labCase._id, userId, "learn");
    expect(resumed.resumed).toBe(true);
    expect(resumed.attempt.variantIndex).toBe(second.attempt.variantIndex);
    expect(resumed.case.panel[0].value).toBe("131");
  });

  it("зачётный повтор через сутки идёт по другому варианту", async () => {
    const first = await startLabAttempt(labCase._id, userId, "exam");
    await submitLabAttempt(first.attempt._id, userId, { flags: ["hgb", "ferritin"] });
    await LabAttempt.updateOne(
      { _id: first.attempt._id },
      { $set: { startedAt: new Date(Date.now() - COOLDOWN_MS - 1000) } },
    );
    const second = await startLabAttempt(labCase._id, userId, "exam");
    expect(second.attempt.counted).toBe(true);
    expect(second.attempt.variantIndex).toBe(1);
  });
});

describe("эталон варианта не утекает", () => {
  it("санитизованный кейс не содержит значимых отклонений", () => {
    const clean = sanitizeLabForLearner(labCase, 1);
    expect(clean.significantAbnormal).toBeUndefined();
    expect(clean.variants).toBeUndefined();
    expect(clean.impression).toBeUndefined();
    // Но факт наличия вариантов виден — это объясняет разные цифры у коллег.
    expect(clean.variantCount).toBe(1);
  });

  it("в списке кейсов вариантов нет", async () => {
    const items = await listLabCases({ isEditor: false, scope: "published" });
    expect(items).toHaveLength(1);
    expect(items[0].variants).toBeUndefined();
    expect(items[0].significantAbnormal).toBeUndefined();
  });
});

describe("нормализация вариантов от ИИ", () => {
  const keys = new Set(["hgb", "ferritin", "plt"]);

  it("чужие ключи выбрасываются — вариант не может ввести новый показатель", () => {
    const [v] = normalizeLabVariants(
      [
        {
          label: "X",
          panel: [
            { key: "hgb", value: "100" },
            { key: "crp", value: "48" },
          ],
          significantAbnormal: ["hgb", "crp"],
        },
      ],
      keys,
    );
    expect(v.panel.map((p) => p.key)).toEqual(["hgb"]);
    expect(v.significantAbnormal).toEqual(["hgb"]);
  });

  it("вариант без изменённых значений отбрасывается целиком", () => {
    const res = normalizeLabVariants(
      [{ label: "Пустой", panel: [{ key: "crp", value: "5" }] }, { label: "Без панели" }],
      keys,
    );
    expect(res).toEqual([]);
  });

  it("подпись подставляется, если модель её не дала", () => {
    const [v] = normalizeLabVariants([{ panel: [{ key: "hgb", value: "95" }] }], keys);
    expect(v.label).toBe("Вариант 1");
  });

  it("больше четырёх вариантов не принимаем", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      label: `В${i}`,
      panel: [{ key: "hgb", value: String(90 + i) }],
    }));
    expect(normalizeLabVariants(many, keys)).toHaveLength(4);
  });

  it("варианты сценария: чужие ключи обследований выбрасываются", () => {
    const res = normalizeVpVariants(
      [
        {
          label: "Б",
          presentation: "Мужчина 50 лет",
          results: [
            { key: "rf", resultText: "положительный" },
            { key: "mri", resultText: "выдуманное обследование" },
          ],
        },
      ],
      new Set(["rf", "xray"]),
    );
    expect(res[0].results.map((r) => r.key)).toEqual(["rf"]);
  });

  it("мусор вместо массива не роняет нормализацию", () => {
    expect(normalizeLabVariants(null, keys)).toEqual([]);
    expect(normalizeVpVariants("нет", new Set())).toEqual([]);
  });
});
