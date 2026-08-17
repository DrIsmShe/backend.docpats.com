// __tests__/clinic-core/clinic-subscription.test.js
//
// Пробный период клиники и заморозка при неоплате.
//
// Бесплатного клинического уровня нет намеренно: клиника — организация с
// бюджетом. Но до сих пор она получала его де-факто: Clinic.tier по
// умолчанию «starter», а он отображался в clinic_start — тариф за 99 $
// выдавался бессрочно и даром, то есть неоплата не меняла ничего.
//
// Стало: месяц пробного периода, дальше оплата или заморозка. Заморозка
// закрывает ЗАПИСЬ, но не чтение — в клинике лежат медицинские карты, и
// отключать к ним доступ из-за неоплаченного счёта значит наказывать
// пациентов за долг организации.

import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import {
  resolveClinicAccess,
  resolveClinicPlan,
  CLINIC_TRIAL_DAYS,
} from "../../modules/clinic/clinic-core/services/clinicPlan.service.js";
import * as clinicService from "../../modules/clinic/clinic-core/services/clinic.service.js";
import Clinic from "../../modules/clinic/clinic-core/models/clinic.model.js";
import clinicWriteGate from "../../modules/clinic/clinic-core/middlewares/clinicWriteGate.js";
import { runWithTenantContext } from "../../common/context/tenantContext.js";
import { createTestDoctor } from "../helpers/createTestUser.js";

const DAY = 24 * 60 * 60 * 1000;

async function makeClinic(overrides = {}) {
  const { user } = await createTestDoctor(overrides.owner || {});
  const { clinic } = await clinicService.createClinic(
    { name: `Клиника ${Date.now()}${Math.random()}`, ...overrides.data },
    user._id,
  );
  return { clinic, owner: user };
}

describe("пробный период клиники", () => {
  it("назначается при создании и длится CLINIC_TRIAL_DAYS", async () => {
    const { clinic } = await makeClinic();
    const fresh = await Clinic.findById(clinic._id).lean();

    expect(fresh.trialEndsAt).toBeInstanceOf(Date);
    const days = Math.round(
      (new Date(fresh.trialEndsAt) - Date.now()) / DAY,
    );
    expect(days).toBe(CLINIC_TRIAL_DAYS);
  });

  it("во время пробного клиника работает на лимитах Start", async () => {
    const { clinic } = await makeClinic();
    const access = await resolveClinicAccess(clinic._id);

    expect(access.state).toBe("trial");
    expect(access.plan).toBe("clinic_start");
    expect(await resolveClinicPlan(clinic._id)).toBe("clinic_start");
  });

  it("после окончания пробного без оплаты — заморозка, а не тариф даром", async () => {
    const { clinic } = await makeClinic();
    await Clinic.updateOne(
      { _id: clinic._id },
      { $set: { trialEndsAt: new Date(Date.now() - DAY) } },
    );

    const access = await resolveClinicAccess(clinic._id);
    expect(access.state).toBe("frozen");
    // Ключевое: НЕ clinic_start. Иначе неоплата не меняет ничего.
    expect(access.plan).toBeNull();
  });

  it("оплата владельцем перекрывает пробный период", async () => {
    const { clinic } = await makeClinic({
      owner: {
        subscriptionPlan: "clinic",
        subscriptionEndsAt: new Date(Date.now() + 30 * DAY),
      },
    });

    const access = await resolveClinicAccess(clinic._id);
    expect(access.state).toBe("active");
    expect(access.plan).toBe("clinic");
  });

  it("истёкшая оплата при истёкшем пробном — заморозка", async () => {
    const { clinic } = await makeClinic({
      owner: {
        subscriptionPlan: "clinic_pro",
        subscriptionEndsAt: new Date(Date.now() - DAY),
      },
    });
    await Clinic.updateOne(
      { _id: clinic._id },
      { $set: { trialEndsAt: new Date(Date.now() - 60 * DAY) } },
    );

    const access = await resolveClinicAccess(clinic._id);
    expect(access.state).toBe("frozen");
  });
});

describe("заморозка закрывает запись, но не чтение", () => {
  /** Мини-приложение с гейтом и контекстом конкретной клиники. */
  function appFor(clinicId) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) =>
      runWithTenantContext({ clinicId: String(clinicId), userId: "u1" }, () =>
        next(),
      ),
    );
    app.use(clinicWriteGate);
    app.get("/patients", (req, res) => res.json({ ok: "read" }));
    app.post("/patients", (req, res) => res.json({ ok: "write" }));
    app.post("/logout", (req, res) => res.json({ ok: "logout" }));
    return app;
  }

  async function frozenClinic() {
    const { clinic } = await makeClinic();
    await Clinic.updateOne(
      { _id: clinic._id },
      { $set: { trialEndsAt: new Date(Date.now() - DAY) } },
    );
    return clinic;
  }

  it("чтение работает: в клинике лежат медицинские карты", async () => {
    const clinic = await frozenClinic();
    const res = await request(appFor(clinic._id)).get("/patients");
    expect(res.status).toBe(200);
  });

  it("запись отклоняется с 402 и понятной причиной", async () => {
    const clinic = await frozenClinic();
    const res = await request(appFor(clinic._id)).post("/patients").send({});

    expect(res.status).toBe(402);
    expect(res.body.error).toBe("CLINIC_SUBSCRIPTION_REQUIRED");
    expect(res.body.message).toMatch(/оплат/i);
  });

  it("выход из системы не блокируется — иначе человек заперт", async () => {
    const clinic = await frozenClinic();
    const res = await request(appFor(clinic._id)).post("/logout");
    expect(res.status).toBe(200);
  });

  it("во время пробного периода запись работает", async () => {
    const { clinic } = await makeClinic();
    const res = await request(appFor(clinic._id)).post("/patients").send({});
    expect(res.status).toBe(200);
  });
});
