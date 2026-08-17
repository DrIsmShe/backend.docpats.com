// __tests__/foundation/doctor-free-plan.test.js
//
// Бесплатный врачебный уровень.
//
// До его появления откат вёл на doctor_lite — ПЛАТНЫЙ тариф за 9 $.
// Врач, переставший платить, продолжал бессрочно получать 500 вопросов,
// 5 разборов, 30 пациентов и час видео. «Блокировка при неоплате»
// существовала только на словах.

import { describe, it, expect } from "vitest";
import {
  PLAN_LIMITS,
  PLAN_PRICES,
  PLAN_DISPLAY_NAMES,
  getLimit,
  resolveEffectivePlan,
} from "../../common/config/aiPlanLimits.js";

const PAST = new Date(Date.now() - 24 * 3600 * 1000);
const FUTURE = new Date(Date.now() + 30 * 24 * 3600 * 1000);

describe("doctor_free — куда попадает врач, который не платит", () => {
  it("после пробного периода", async () => {
    expect(
      resolveEffectivePlan({ role: "doctor", trialEndsAt: PAST }),
    ).toBe("doctor_free");
  });

  it("после окончания оплаченной подписки", async () => {
    expect(
      resolveEffectivePlan({
        role: "doctor",
        subscriptionPlan: "doctor_pro",
        subscriptionEndsAt: PAST,
      }),
    ).toBe("doctor_free");
  });

  it("действующая подписка не трогается", async () => {
    expect(
      resolveEffectivePlan({
        role: "doctor",
        subscriptionPlan: "doctor_pro",
        subscriptionEndsAt: FUTURE,
      }),
    ).toBe("doctor_pro");
  });

  it("пробный период важнее бесплатного уровня", async () => {
    expect(
      resolveEffectivePlan({ role: "doctor", trialEndsAt: FUTURE }),
    ).toBe("doctor_trial");
  });
});

describe("doctor_free — устройство тарифа", () => {
  it("НИ ОДНОГО нуля: 0 означает «фича не описана» и предел не применяется", () => {
    // videoQuota, storageQuota, diagnostics/quota и consultation все
    // трактуют 0 как «не ограничивать». Ноль здесь означал бы не
    // «нельзя», а «сколько угодно» — ровно наоборот замыслу.
    const zeros = Object.entries(PLAN_LIMITS.doctor_free).filter(
      ([, v]) => v === 0,
    );
    expect(zeros).toEqual([]);
  });

  it("ни одного безлимита", () => {
    const infinite = Object.entries(PLAN_LIMITS.doctor_free).filter(
      ([, v]) => v === -1,
    );
    expect(infinite).toEqual([]);
  });

  it("нигде не выше платного Lite", () => {
    // Иначе бесплатный уровень отменяет смысл первой платной ступени.
    //
    // Строгое «меньше» требовать нельзя на осях, где Lite уже на полу:
    // у aiArticles там 1, а опуститься ниже единицы невозможно — ноль
    // означает «фича не описана», то есть отсутствие предела вообще.
    for (const [key, freeValue] of Object.entries(PLAN_LIMITS.doctor_free)) {
      const liteValue = PLAN_LIMITS.doctor_lite[key];
      if (liteValue === undefined) continue;
      expect(
        freeValue,
        `${key}: free ${freeValue} выше Lite ${liteValue}`,
      ).toBeLessThanOrEqual(
        liteValue === -1 ? Number.MAX_SAFE_INTEGER : liteValue,
      );
    }
  });

  it("отличается от Lite на подавляющем большинстве осей", () => {
    // Проверка от обратного к предыдущей: «не выше» выполнялось бы и
    // полной копией Lite, а это вернуло бы ровно ту проблему, ради
    // которой уровень заводился.
    const axes = Object.keys(PLAN_LIMITS.doctor_free);
    const strictlyLower = axes.filter(
      (k) => PLAN_LIMITS.doctor_free[k] < PLAN_LIMITS.doctor_lite[k],
    );
    expect(strictlyLower.length).toBeGreaterThanOrEqual(axes.length - 1);
  });

  it("не продаётся: нет цены", () => {
    expect(PLAN_PRICES.doctor_free).toBeUndefined();
  });

  it("имеет человеческое название — иначе в интерфейсе виден сырой ключ", () => {
    expect(PLAN_DISPLAY_NAMES.doctor_free).toBeTruthy();
  });

  it("покрывает те же оси, что и платные врачебные тарифы", () => {
    // Пропущенная ось = отсутствие предела на ней, то есть дыра именно в
    // том тарифе, где предел нужнее всего.
    for (const key of Object.keys(PLAN_LIMITS.doctor_lite)) {
      expect(
        getLimit("doctor_free", key),
        `${key} не описан в doctor_free`,
      ).toBeGreaterThan(0);
    }
  });
});
