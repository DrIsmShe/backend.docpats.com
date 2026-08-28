// __tests__/surgery/simulationQuota.test.js
//
// Симуляция — самая дорогая функция платформы в пересчёте на действие:
// один запуск это n обращений к модели изображений, на gpt-image-2 при
// quality=high четыре варианта стоят около $0.66. Врач, нажимающий
// «Сгенерировать» подряд, расходует свою годовую подписку за вечер.
//
// Поэтому здесь проверяется не «работает ли счётчик», а то, что открытого
// счёта не остаётся ни в одном углу: ни у тарифа без этой функции, ни у
// того, чей ключ забыли прописать.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import Simulation from "../../modules/surgery/simulation.model.js";
import { createTestDoctor } from "../helpers/createTestUser.js";
import { PLAN_LIMITS } from "../../common/config/aiPlanLimits.js";
import {
  assertSimulationAllowed,
  simulationQuotaLeft,
  usedInWindow,
} from "../../modules/surgery/simulationQuota.service.js";

const DAY = 24 * 60 * 60 * 1000;

async function makeUser(plan, extra = {}) {
  const { user } = await createTestDoctor({
    subscriptionPlan: plan,
    subscriptionEndsAt: new Date(Date.now() + 30 * DAY),
    // Пробный период выдаёт лимиты Growth и перекрыл бы проверяемый тариф.
    trialEndsAt: new Date(Date.now() - DAY),
    ...extra,
  });
  return user;
}

// Пишем в коллекцию напрямую: у схемы включены timestamps, и переданный
// createdAt при обычном create() был бы перезаписан «сейчас» — проверить
// выпадение из окна 30 дней стало бы нечем.
async function makeSimulations(surgeonId, count, { ageMs = 0, status = "done" } = {}) {
  if (count <= 0) return;
  const at = new Date(Date.now() - ageMs);
  await Simulation.collection.insertMany(
    Array.from({ length: count }, (_, i) => ({
      caseId: new mongoose.Types.ObjectId(),
      surgeonId,
      sourcePhotoFilename: `photo-${i}.jpg`,
      status,
      createdAt: at,
      updatedAt: at,
      disclaimerAccepted: true,
    })),
  );
}

describe("квота симуляций", () => {
  let doctor;

  beforeEach(async () => {
    doctor = await makeUser("doctor_basic"); // 15 за 30 дней
  });

  it("считает только доведённые до конца", async () => {
    await makeSimulations(doctor._id, 3, { status: "done" });
    await makeSimulations(doctor._id, 5, { status: "failed" });
    await makeSimulations(doctor._id, 2, { status: "pending" });

    // Отказ по маске, пустому счёту или контент-политике денег не стоит:
    // списывать за него квоту — значит наказывать врача за наши ошибки.
    expect(await usedInWindow(doctor._id)).toBe(3);
  });

  it("не считает то, что вышло за окно 30 дней", async () => {
    await makeSimulations(doctor._id, 4, { ageMs: 40 * DAY });
    await makeSimulations(doctor._id, 2);

    expect(await usedInWindow(doctor._id)).toBe(2);
  });

  it("пропускает, пока лимит не выбран", async () => {
    await makeSimulations(doctor._id, 14);
    const quota = await assertSimulationAllowed(doctor._id);
    expect(quota.used).toBe(14);
    expect(quota.limit).toBe(15);
  });

  it("на исчерпанной квоте отказывает до обращения к модели", async () => {
    await makeSimulations(doctor._id, 15);
    await expect(assertSimulationAllowed(doctor._id)).rejects.toThrow(
      /Симуляции на тарифе .* закончились/,
    );
  });

  it("остаток считается для интерфейса", async () => {
    await makeSimulations(doctor._id, 6);
    const left = await simulationQuotaLeft(doctor._id);
    expect(left).toMatchObject({ unlimited: false, limit: 15, used: 6, left: 9 });
  });

  // Главная защита от открытого счёта: у прочих фич отсутствие ключа в
  // тарифе означает «ограничение неприменимо», и для функции по $0.66 за
  // нажатие такое умолчание недопустимо.
  it("тариф без этой функции получает отказ, а не безлимит", async () => {
    const patient = await makeUser("patient_std", {
      role: "patient",
      isDoctor: false,
      isPatient: true,
    });

    await expect(assertSimulationAllowed(patient._id)).rejects.toThrow(
      /не входит в тариф/,
    );
  });

  it("несуществующий пользователь тоже не получает безлимит", async () => {
    const ghost = new mongoose.Types.ObjectId();
    await expect(assertSimulationAllowed(ghost)).rejects.toThrow(
      /не входит в тариф/,
    );
  });

  it("бесплатный врачебный уровень ограничен, но не запрещён", async () => {
    const free = await makeUser("doctor_free");
    const left = await simulationQuotaLeft(free._id);
    expect(left.limit).toBe(2);
  });

  // Забытый ключ в тарифе означает ЗАПРЕТ (см. planQuota), а не безлимит.
  // Это защита от открытого счёта, но у неё есть обратная сторона: платный
  // врач, чей план забыли прописать, молча теряет функцию. Проверяем, что
  // прописаны все.
  it("каждый платный врачебный и клинический план имеет свою квоту", () => {
    const plans = [
      "doctor_trial",
      "doctor_free",
      "doctor_lite",
      "doctor_basic",
      "doctor_super",
      "doctor_pro",
      "clinic_start",
      "clinic",
      "clinic_pro",
    ];

    const missing = plans.filter(
      (p) => typeof PLAN_LIMITS[p]?.aiSimulations !== "number",
    );
    expect(missing).toEqual([]);
  });

  it("квота растёт вместе с ценой тарифа", () => {
    // Витрина обещает врачу, что старший план даёт больше. Сетка, где
    // Growth щедрее Pro, — это не опечатка в числе, а неверное обещание.
    const ladder = ["doctor_free", "doctor_lite", "doctor_basic", "doctor_super", "doctor_pro"];
    const values = ladder.map((p) => PLAN_LIMITS[p].aiSimulations);
    const sorted = [...values].sort((a, b) => a - b);
    expect(values).toEqual(sorted);
  });
});
