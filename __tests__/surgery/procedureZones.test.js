// __tests__/surgery/procedureZones.test.js
//
// Пороги площади — единственное, что отделяет симуляцию операции от
// перерисовки лица. Числа здесь не косметические: при 30% кадра врач
// получал чужой подбородок со швами по краю выделения, формально уложившись
// в лимит.

import { describe, it, expect } from "vitest";
import {
  maxPaintedPct,
  isFaceProcedure,
  MIN_PAINTED_PCT,
} from "../../modules/surgery/procedureZones.js";

describe("пороги площади правки", () => {
  it("точечные операции на лице держат зону в единицах процентов", () => {
    // Полоска под веками — 2-3% кадра, нос целиком — 4-6%. Двенадцать
    // процентов оставляют запас, но исключают «пол-лица».
    for (const p of ["blepharoplasty", "rhinoplasty", "brow_lift", "lip_augmentation"]) {
      expect(maxPaintedPct(p)).toBe(12);
    }
  });

  it("обширным лицевым разрешено больше — но не половина кадра", () => {
    for (const p of ["facelift", "neck_lift"]) {
      expect(maxPaintedPct(p)).toBe(25);
    }
  });

  it("операции на теле не ограничены лицевым порогом", () => {
    for (const p of ["abdominoplasty", "liposuction", "breast_augmentation"]) {
      expect(maxPaintedPct(p)).toBe(70);
    }
  });

  it("незнакомая процедура получает телесный порог, а не отказ", () => {
    expect(maxPaintedPct("unknown_procedure")).toBe(70);
    expect(isFaceProcedure("unknown_procedure")).toBe(false);
  });

  it("лицевые процедуры опознаются в обеих группах", () => {
    expect(isFaceProcedure("blepharoplasty")).toBe(true);
    expect(isFaceProcedure("facelift")).toBe(true);
    expect(isFaceProcedure("abdominoplasty")).toBe(false);
  });

  it("нижний порог отсекает след кисти", () => {
    expect(MIN_PAINTED_PCT).toBeGreaterThanOrEqual(0.5);
  });
});
