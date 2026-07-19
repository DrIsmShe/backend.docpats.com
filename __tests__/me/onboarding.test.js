// __tests__/me/onboarding.test.js
//
// Онбординг: чек-лист заполнения профиля из реальных данных.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import DoctorProfile from "../../common/models/DoctorProfile/profileDoctor.js";
import { getOnboarding } from "../../modules/me/onboarding.controller.js";
import { createTestDoctor } from "../helpers/createTestUser.js";

const oid = () => new mongoose.Types.ObjectId();

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

describe("онбординг — чек-лист профиля", () => {
  it("свежий врач: 0 из 6 выполнено, шаги на месте", async () => {
    const { userId } = await createTestDoctor();
    const res = mockRes();
    await getOnboarding({ session: { userId: String(userId) } }, res);

    expect(res.body.success).toBe(true);
    expect(res.body.role).toBe("doctor");
    expect(res.body.total).toBe(6);
    expect(res.body.completed).toBe(0);
    const keys = res.body.steps.map((s) => s.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "avatar",
        "specialization",
        "verification",
        "schedule",
        "article",
        "invite",
      ]),
    );
  });

  it("частично заполненный врач считает выполненные шаги", async () => {
    const { userId } = await createTestDoctor({
      avatar: "/uploads/custom-avatar.png",
      specialization: oid(),
      referralCount: 2,
    });
    await DoctorProfile.create({
      userId,
      verificationStatus: "approved",
      phoneHash: oid().toString(),
    });

    const res = mockRes();
    await getOnboarding({ session: { userId: String(userId) } }, res);

    const done = res.body.steps.filter((s) => s.done).map((s) => s.key);
    expect(done).toEqual(
      expect.arrayContaining([
        "avatar",
        "specialization",
        "verification",
        "invite",
      ]),
    );
    expect(res.body.completed).toBe(4); // article + schedule ещё не выполнены
  });

  it("пациент получает свой набор шагов", async () => {
    const { userId } = await createTestDoctor({
      role: "patient",
      isDoctor: false,
      isPatient: true,
    });
    const res = mockRes();
    await getOnboarding({ session: { userId: String(userId) } }, res);
    expect(res.body.role).toBe("patient");
    const keys = res.body.steps.map((s) => s.key);
    expect(keys).toEqual(
      expect.arrayContaining(["avatar", "consultation", "doctor", "invite"]),
    );
  });

  it("без авторизации → 401", async () => {
    const res = mockRes();
    await getOnboarding({ session: {} }, res);
    expect(res.statusCode).toBe(401);
  });
});
