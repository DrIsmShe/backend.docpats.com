// __tests__/referral/bonus-consultations.test.js
//
// Реферальный бонус для пациентов: bonusConsultations прибавляется к лимиту
// AI-консультаций (consultation.service.consultationMaxFor).

import { describe, it, expect } from "vitest";
import { checkConsultationLimit } from "../../modules/consultation/consultation.service.js";
import { createTestDoctor } from "../helpers/createTestUser.js";

async function createPatient(overrides = {}) {
  return createTestDoctor({
    role: "patient",
    isDoctor: false,
    isPatient: true,
    ...overrides,
  });
}

describe("реферальный бонус: bonusConsultations", () => {
  it("бонус увеличивает лимит AI-консультаций на его величину", async () => {
    const base = await createPatient();
    const bonus = await createPatient({ bonusConsultations: 5 });

    const b0 = await checkConsultationLimit(base.userId.toString());
    const b5 = await checkConsultationLimit(bonus.userId.toString());

    expect(b5.max).toBe(b0.max + 5);
    expect(b5.remaining).toBe(b0.remaining + 5);
  });

  it("без бонуса лимит равен базовому auth-лимиту, used=0", async () => {
    const p = await createPatient();
    const r = await checkConsultationLimit(p.userId.toString());
    expect(r.max).toBeGreaterThan(0);
    expect(r.used).toBe(0);
    expect(r.allowed).toBe(true);
  });

  it("гость (без userId) бонуса не получает", async () => {
    const r = await checkConsultationLimit(null, "guest-xyz");
    expect(r.max).toBeGreaterThan(0);
    expect(r.used).toBe(0);
  });
});
