// __tests__/diagnostics/caseView.test.js
//
// Что интерфейс получает вместе с делом.
//
// Проверяются две вещи, которые легко потерять при рефакторинге и которые
// молча ломают правильное поведение, а не падают:
//
//   1. blockers/canAnalyze в ответе дела. Их считает сервер теми же условиями,
//      что применит при запуске. Если поле пропадёт, клиент начнёт решать сам,
//      и две копии одного правила разойдутся — кнопка «Разобрать» окажется
//      активной там, где сервер откажет, или, хуже, интерфейс пообещает
//      проверку обезличивания, которой на сервере уже нет.
//
//   2. Справочник показателей. Ключ показателя — рабочее поле: по нему
//      срабатывают пороги критических значений и связки. Если форма ввода
//      строится по своему списку, добавленный на сервере показатель молча не
//      появится, а показатель с чужим ключом молча потеряет пороги.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";

await import("../../modules/diagnostics/index.js"); // регистрация модальностей

const { createCase, addArtifact, updateCase, getCaseFull } = await import(
  "../../modules/diagnostics/core/services/case.service.js"
);
const { describeAnalytes, CRITICAL_THRESHOLDS, PAIRED_CHECKS, analyzePanel } = await import(
  "../../modules/diagnostics/labs/labRules.js"
);

const userId = new mongoose.Types.ObjectId();

describe("дело отдаёт причины, по которым разбор не запустится", () => {
  it("у пустого дела перечислены все невыполненные условия", async () => {
    const c = await createCase({ title: "Новое" }, { userId });
    const view = await getCaseFull(c._id, userId);

    expect(view.canAnalyze).toBe(false);
    // Три условия: обезличивание, согласие, наличие материала.
    expect(view.blockers).toHaveLength(3);
    expect(view.blockers.join(" ")).toMatch(/обезличен/i);
    expect(view.blockers.join(" ")).toMatch(/согласие/i);
  });

  it("причины исчезают по мере выполнения, и последней — разрешение", async () => {
    const c = await createCase(
      { title: "Кашель", clinicalContext: "Мужчина 54 лет, кашель 5 дней" },
      { userId },
    );
    await addArtifact(c._id, { kind: "report", modality: "xray", text: "Инфильтрат справа" }, userId);

    // Контекст и материал есть — остаются два подтверждения врача.
    let view = await getCaseFull(c._id, userId);
    expect(view.canAnalyze).toBe(false);
    expect(view.blockers).toHaveLength(2);

    await updateCase(c._id, { deidentified: true }, userId);
    view = await getCaseFull(c._id, userId);
    expect(view.blockers).toHaveLength(1);
    expect(view.blockers[0]).toMatch(/согласие/i);

    await updateCase(c._id, { aiConsent: true }, userId);
    view = await getCaseFull(c._id, userId);
    expect(view.blockers).toEqual([]);
    expect(view.canAnalyze).toBe(true);
  });

  it("закрытое дело снова блокируется — и говорит, что делать", async () => {
    const c = await createCase({ title: "Дело", clinicalContext: "текст" }, { userId });
    await updateCase(c._id, { deidentified: true, aiConsent: true }, userId);

    const { closeCase } = await import("../../modules/diagnostics/core/services/case.service.js");
    await closeCase(c._id, { summary: "Вывод врача" }, userId);

    const view = await getCaseFull(c._id, userId);
    expect(view.canAnalyze).toBe(false);
    expect(view.blockers.join(" ")).toMatch(/переоткройте/i);
  });

  it("оговорка едет вместе с делом, а не только в интерфейсе", async () => {
    const c = await createCase({ title: "Дело" }, { userId });
    const view = await getCaseFull(c._id, userId);
    expect(view.advisoryNotice).toMatch(/врач/i);
  });
});

describe("справочник показателей для формы ввода", () => {
  const analytes = describeAnalytes();

  it("непустой и у каждого показателя есть ключ и подпись", () => {
    expect(analytes.length).toBeGreaterThan(10);
    for (const a of analytes) {
      expect(a.key).toBeTruthy();
      expect(a.label).toBeTruthy();
      expect(typeof a.unit).toBe("string");
    }
  });

  it("ключи уникальны — иначе в форме два одинаковых пункта", () => {
    const keys = analytes.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("КАЖДЫЙ показатель с порогом критического значения есть в справочнике", () => {
    // Иначе врач физически не сможет ввести его правильным ключом, и порог,
    // ради которого он написан, не сработает никогда.
    const known = new Set(analytes.map((a) => a.key));
    for (const key of Object.keys(CRITICAL_THRESHOLDS)) {
      expect(known.has(key), `порог ${key} есть, а в справочнике его нет`).toBe(true);
    }
  });

  it("КАЖДЫЙ показатель из связок есть в справочнике", () => {
    const known = new Set(analytes.map((a) => a.key));
    for (const pair of PAIRED_CHECKS) {
      for (const key of pair.keys) {
        expect(known.has(key), `связка использует ${key}, а в справочнике его нет`).toBe(true);
      }
    }
  });

  it("порог отдаётся вместе с показателем — врач видит его до ввода", () => {
    const hgb = analytes.find((a) => a.key === "hgb");
    expect(hgb.critical).toMatchObject({ low: 70 });
    expect(hgb.critical.why).toBeTruthy();

    const mcv = analytes.find((a) => a.key === "mcv");
    expect(mcv.critical).toBeNull(); // порога нет — и это честно показано
  });

  it("связанные показатели перечислены и себя не включают", () => {
    const hgb = analytes.find((a) => a.key === "hgb");
    expect(hgb.pairedWith).toContain("ferritin");
    expect(hgb.pairedWith).not.toContain("hgb");
  });

  it("ключ из справочника действительно включает порог в разборе", () => {
    // Смысл всей связки «справочник → форма → сервер»: показатель, введённый
    // ключом из списка, помечается критическим, а тот же самый с произвольным
    // ключом — нет.
    const withKnownKey = analyzePanel([
      { key: "hgb", name: "Гемоглобин", value: 55, unit: "г/л", refLow: 130, refHigh: 170 },
    ]);
    expect(withKnownKey.critical).toHaveLength(1);

    const withCustomKey = analyzePanel([
      { key: "custom1", name: "Гемоглобин", value: 55, unit: "г/л", refLow: 130, refHigh: 170 },
    ]);
    expect(withCustomKey.critical).toHaveLength(0);
    // При этом отклонение от референса бланка видно в обоих случаях.
    expect(withCustomKey.abnormal).toHaveLength(1);
  });
});
