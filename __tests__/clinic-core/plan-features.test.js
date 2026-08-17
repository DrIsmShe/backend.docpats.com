// __tests__/clinic-core/plan-features.test.js
//
// Фичи, включённые в тариф клиники, — отдельно от прав доступа.
//
// До этого флаг analytics стоял в тарифах (Start — нет, Business и
// Enterprise — да) и не читался ни одной строкой кода. Доступ к
// /analytics/overview закрывала только роль, а владелец клиники на Start
// имеет роль owner с полным доступом — то есть открывал аналитику,
// которую ему не продавали, а карточка Start прямо обещала её отсутствие.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import {
  clinicHasFeature,
  resolveClinicPlan,
} from "../../modules/clinic/clinic-core/services/clinicPlan.service.js";
import Clinic from "../../modules/clinic/clinic-core/models/clinic.model.js";
import User from "../../common/models/Auth/users.js";
import { createTestDoctor } from "../helpers/createTestUser.js";

/** Клиника с владельцем на заданном тарифе. */
async function makeClinic({ plan = null, tier = "starter" } = {}) {
  // Через хелпер: у User обязательны шифрованные поля и слепые индексы,
  // а required-валидация в mongoose идёт ДО pre-save хуков, которые их
  // заполняют. Собирать пользователя руками здесь — гарантированная
  // ошибка валидации.
  const { user: owner } = await createTestDoctor({
    ...(plan ? { subscriptionPlan: plan } : {}),
    // Подписка действующая: иначе resolveEffectivePlan уронит её в
    // бесплатный план, и тест проверял бы истечение, а не фичи.
    subscriptionEndsAt: new Date(Date.now() + 30 * 864e5),
  });

  const clinic = await Clinic.create({
    name: "Клиника проверки",
    slug: `check-${Date.now()}-${Math.floor(performance.now())}`,
    ownerId: owner._id,
    tier,
  });

  return { clinic, owner };
}

describe("фичи тарифа клиники", () => {
  let ids;
  beforeEach(() => {
    ids = null;
  });

  it("Start: аналитика не входит в тариф", async () => {
    const { clinic } = await makeClinic({ plan: "clinic_start" });
    expect(await resolveClinicPlan(clinic._id)).toBe("clinic_start");
    expect(await clinicHasFeature(clinic._id, "analytics")).toBe(false);
  });

  it("Business: аналитика входит", async () => {
    const { clinic } = await makeClinic({ plan: "clinic" });
    expect(await clinicHasFeature(clinic._id, "analytics")).toBe(true);
  });

  it("Enterprise: аналитика входит", async () => {
    const { clinic } = await makeClinic({ plan: "clinic_pro" });
    expect(await clinicHasFeature(clinic._id, "analytics")).toBe(true);
  });

  it("план определить нечем — не отказываем", async () => {
    // Клиника, у которой не читается ни план владельца, ни tier, —
    // служебное состояние, а не попытка получить лишнее. Отказ здесь
    // сломал бы рабочие клиники ради несуществующей угрозы.
    const { clinic } = await makeClinic({ plan: "doctor_pro" });
    await Clinic.updateOne({ _id: clinic._id }, { $unset: { tier: 1 } });

    expect(await resolveClinicPlan(clinic._id)).toBeNull();
    expect(await clinicHasFeature(clinic._id, "analytics")).toBe(true);
  });

  it("истёкшая подписка владельца лишает клинику аналитики", async () => {
    const { clinic, owner } = await makeClinic({ plan: "clinic" });
    expect(await clinicHasFeature(clinic._id, "analytics")).toBe(true);

    await User.updateOne(
      { _id: owner._id },
      { $set: { subscriptionEndsAt: new Date(Date.now() - 864e5) } },
    );

    // План владельца упал в бесплатный, остаётся tier = starter.
    expect(await clinicHasFeature(clinic._id, "analytics")).toBe(false);
  });
});
