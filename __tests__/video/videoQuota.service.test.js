// __tests__/video/videoQuota.service.test.js
//
// Месячная квота минут видео по тарифу.
//
// Минуты стояли в прайсе всех тарифов и не читались ни одной строкой
// кода. Проверяем не арифметику, а поведение на границах: когда пускаем,
// когда отказываем и чей тариф при этом смотрим.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import CallLog from "../../common/models/Communication/callLog.js";
import User from "../../common/models/Auth/users.js";
import {
  assertVideoAllowed,
  videoQuotaLeft,
  videoSecondsUsed,
} from "../../common/video/videoQuota.service.js";
import { PLAN_LIMITS } from "../../common/config/aiPlanLimits.js";

/** Врач на заданном тарифе.
 *
 * Минуты видео живут только во врачебных и клинических планах: приём
 * назначает и ведёт врач, и с его тарифа они и списываются. У пациента
 * лимита нет намеренно — иначе он не попал бы на приём, который ему
 * назначили и за который он врачу заплатил. */
async function doctorOn(plan) {
  const suffix = new mongoose.Types.ObjectId().toString();
  return User.create({
    emailEncrypted: `vq-${suffix}@example.com`,
    firstNameEncrypted: "Тест",
    lastNameEncrypted: "Врач",
    emailHash: `h-${suffix}`,
    firstNameHash: "placeholder",
    lastNameHash: "placeholder",
    username: `vq_${suffix}`,
    password: "hashed-password-placeholder",
    dateOfBirth: new Date("1990-01-01"),
    bio: "test",
    agreement: true,
    role: "doctor",
    trialEndsAt: new Date(0), // пробный истёк — иначе перекроет тариф
    subscriptionPlan: plan,
  });
}

/** Записать звонок длительностью minutes, начавшийся ago миллисекунд назад. */
async function logCall(userId, minutes, ago = 60_000, asCallee = false) {
  const startedAt = new Date(Date.now() - ago);
  const endedAt = new Date(startedAt.getTime() + minutes * 60_000);
  return CallLog.create({
    callSessionId: `cs-${new mongoose.Types.ObjectId()}`,
    roomId: `room-${new mongoose.Types.ObjectId()}`,
    startedAt,
    endedAt,
    durationSec: minutes * 60,
    [asCallee ? "calleeUserId" : "callerUserId"]: String(userId),
  });
}

describe("месячная квота минут видео", () => {
  let doc;

  beforeEach(async () => {
    doc = await doctorOn("doctor_lite");
  });

  it("в пределах квоты звонок разрешён", async () => {
    await logCall(doc._id, 10);
    await expect(assertVideoAllowed(doc._id)).resolves.toBeUndefined();
  });

  it("исчерпанная квота отказывает и называет тариф", async () => {
    const limit = PLAN_LIMITS.doctor_lite.videoMinutes;
    await logCall(doc._id, limit);

    await expect(assertVideoAllowed(doc._id)).rejects.toThrow(/минуты видео/i);
    // Отказ обязан называть тариф: без этого врач не понимает, что делать.
    await expect(assertVideoAllowed(doc._id)).rejects.toThrow(/Doctor Lite/);
  });

  it("минуты считаются и когда человек принимал звонок, а не звонил", async () => {
    const limit = PLAN_LIMITS.doctor_lite.videoMinutes;
    await logCall(doc._id, limit, 60_000, true); // как принимающая сторона

    expect(await videoSecondsUsed(doc._id)).toBe(limit * 60);
    await expect(assertVideoAllowed(doc._id)).rejects.toThrow();
  });

  it("звонки старше 30 дней квоту не занимают — окно скользящее", async () => {
    const limit = PLAN_LIMITS.doctor_lite.videoMinutes;
    await logCall(doc._id, limit * 3, 31 * 24 * 60 * 60 * 1000);

    await expect(assertVideoAllowed(doc._id)).resolves.toBeUndefined();
  });

  it("старший тариф на том же объёме работает", async () => {
    const pro = await doctorOn("doctor_pro");
    await logCall(pro._id, PLAN_LIMITS.doctor_lite.videoMinutes);

    await expect(assertVideoAllowed(pro._id)).resolves.toBeUndefined();
  });

  it("чужие звонки в квоту не попадают", async () => {
    const other = await doctorOn("doctor_lite");
    await logCall(other._id, PLAN_LIMITS.doctor_lite.videoMinutes * 2);

    await expect(assertVideoAllowed(doc._id)).resolves.toBeUndefined();
    expect(await videoSecondsUsed(doc._id)).toBe(0);
  });

  it("без пользователя предел не применяется: служебный вызов не должен падать", async () => {
    const orphan = new mongoose.Types.ObjectId();
    await expect(assertVideoAllowed(orphan)).resolves.toBeUndefined();
    const left = await videoQuotaLeft(orphan);
    expect(left.limit).toBeNull();
  });

  it("остаток можно показать до начала звонка", async () => {
    await logCall(doc._id, 10);
    const left = await videoQuotaLeft(doc._id);

    expect(left.used).toBe(10);
    expect(left.limit).toBe(PLAN_LIMITS.doctor_lite.videoMinutes);
    expect(left.remaining).toBe(PLAN_LIMITS.doctor_lite.videoMinutes - 10);
    expect(left.plan).toBe("doctor_lite");
  });
});
