// __tests__/foundation/doctor-free-plan.test.js
//
// Бесплатный врачебный уровень — тарифная сетка v5.
//
// Смысл поменялся. Раньше Free был крошечной витриной (5 пациентов, час
// видео), строго меньше платного Lite по всем осям. Теперь Free — РАБОЧИЙ
// бесплатный тариф: не-ИИ функции на уровне бывшего Lite (30 пациентов,
// 60 мин видео, 400 файлов, 3 фильма), но ВЕСЬ ИИ выключен наглухо.
//
// Ось Free теперь не «меньше везде», а «то же, что Lite, но без ИИ»:
//   • не-ИИ функции равны Lite (это и есть предложение бесплатного тарифа);
//   • ИИ выключает жёсткий гейт planHasAI(), а не занижение чисел (0 у
//     квота-сервисов означает «безлимит», см. aiPlanLimits.js).

import { describe, it, expect } from "vitest";
import {
  PLAN_LIMITS,
  PLAN_PRICES,
  PLAN_DISPLAY_NAMES,
  getLimit,
  resolveEffectivePlan,
  planHasAI,
  videraFilmsAllowed,
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

describe("doctor_free — устройство тарифа (v5)", () => {
  it("НИ ОДНОГО нуля: 0 означает «фича не описана» и предел не применяется", () => {
    // videoQuota, storageQuota, diagnostics/quota и consultation все
    // трактуют 0 как «не ограничивать». Ноль здесь означал бы «сколько
    // угодно» — ровно наоборот замыслу.
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

  it("нигде не выше бывшего Lite", () => {
    // Free не может быть щедрее платной ступени, которую он заменил.
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

  it("не-ИИ функции подняты РОВНО до уровня Lite — это и есть предложение", () => {
    // Проверка от обратного к «крошечной витрине»: рабочие оси не должны
    // быть урезаны, иначе бесплатный тариф снова станет демо, а не входом.
    // previsitIntakes сюда НЕ входит: это квота ИИ-разбора анкеты, а не
    // сбора формы — на Free разбор выключен гейтом (форму пациент всё равно
    // заполняет, ответы сохраняются).
    for (const key of [
      "patientsInOffice",
      "videoMinutes",
      "storedFiles",
      "examQuestions",
    ]) {
      expect(
        PLAN_LIMITS.doctor_free[key],
        `${key}: free должен совпадать с Lite`,
      ).toBe(PLAN_LIMITS.doctor_lite[key]);
    }
  });

  it("ИИ выключен жёстким гейтом, а не числами", () => {
    expect(planHasAI("doctor_free")).toBe(false);
  });

  it("даёт ровно 3 бесплатных фильма", () => {
    expect(PLAN_LIMITS.doctor_free.videraFilms).toBe(3);
    expect(videraFilmsAllowed("doctor_free")).toBe(3);
  });

  it("не продаётся: нет цены", () => {
    expect(PLAN_PRICES.doctor_free).toBeUndefined();
  });

  it("имеет человеческое название — иначе в интерфейсе виден сырой ключ", () => {
    expect(PLAN_DISPLAY_NAMES.doctor_free).toBeTruthy();
  });

  it("покрывает те же оси, что и платные врачебные тарифы", () => {
    // Пропущенная ось = отсутствие предела на ней.
    for (const key of Object.keys(PLAN_LIMITS.doctor_lite)) {
      expect(
        getLimit("doctor_free", key),
        `${key} не описан в doctor_free`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("выключатель ИИ (planHasAI) — v5", () => {
  it("ИИ выключен ТОЛЬКО у doctor_free", () => {
    expect(planHasAI("doctor_free")).toBe(false);
  });

  it("платные врачебные тарифы и пробный — с ИИ", () => {
    for (const plan of [
      "doctor_trial",
      "doctor_lite",
      "doctor_basic",
      "doctor_super",
      "doctor_pro",
    ]) {
      expect(planHasAI(plan), `${plan} должен иметь ИИ`).toBe(true);
    }
  });

  it("пациент на free сохраняет метрованное демо ИИ (не выключен)", () => {
    // Для пациента помощник и есть продукт: выключать его в ноль нельзя.
    expect(planHasAI("patient_free")).toBe(true);
    expect(getLimit("patient_free", "aiConsultations")).toBeGreaterThan(0);
  });

  it("гость сохраняет своё демо ИИ", () => {
    expect(planHasAI("guest")).toBe(true);
  });

  it("резолвер эффективного плана + гейт: неоплативший врач без ИИ", () => {
    const plan = resolveEffectivePlan({ role: "doctor", trialEndsAt: PAST });
    expect(planHasAI(plan)).toBe(false);
  });

  it("резолвер + гейт: врач на пробном — с ИИ", () => {
    const plan = resolveEffectivePlan({ role: "doctor", trialEndsAt: FUTURE });
    expect(planHasAI(plan)).toBe(true);
  });
});

describe("лимит фильмов DP-Videra (videraFilmsAllowed) — v5", () => {
  it("Free (врач и пациент) — 3 фильма", () => {
    expect(videraFilmsAllowed("doctor_free")).toBe(3);
    expect(videraFilmsAllowed("patient_free")).toBe(3);
  });

  it("гость — 0 (студия требует входа)", () => {
    expect(videraFilmsAllowed("guest")).toBe(0);
  });

  it("платные тарифы и пробный — без лимита (-1)", () => {
    for (const plan of [
      "doctor_trial",
      "doctor_basic",
      "doctor_super",
      "doctor_pro",
      "patient_std",
      "clinic_start",
      "clinic",
      "clinic_pro",
    ]) {
      expect(videraFilmsAllowed(plan), `${plan} должен быть без лимита`).toBe(-1);
    }
  });
});
