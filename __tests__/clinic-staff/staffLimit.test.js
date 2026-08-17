// __tests__/clinic-staff/staffLimit.test.js
//
// Предел числа сотрудников по тарифу клиники.
//
// Ограничения не существовало вовсе: Clinic Start за 99 $ обещал «до 5
// врачей», а завести можно было сколько угодно. Причина — два
// несовпадающих словаря тарифов (Clinic.tier против PLAN_LIMITS) и то,
// что оплата пишет тариф владельцу, а не клинике.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import * as clinicService from "../../modules/clinic/clinic-core/services/clinic.service.js";
import ClinicMembership from "../../modules/clinic/clinic-staff/models/clinicMembership.model.js";
import { assertStaffLimit } from "../../modules/clinic/clinic-staff/services/staff.service.js";
import {
  resolveClinicPlan,
  clinicDoctorLimit,
} from "../../modules/clinic/clinic-core/services/clinicPlan.service.js";
import Clinic from "../../modules/clinic/clinic-core/models/clinic.model.js";
import User from "../../common/models/Auth/users.js";
import { PLAN_LIMITS } from "../../common/config/aiPlanLimits.js";

let counter = 0;

async function makeOwner(plan) {
  counter += 1;
  const suffix = `${Date.now()}-${counter}`;
  return User.create({
    emailEncrypted: `owner-${suffix}@example.com`,
    firstNameEncrypted: "Владелец",
    lastNameEncrypted: "Клиники",
    emailHash: `h-${suffix}`,
    firstNameHash: "placeholder",
    lastNameHash: "placeholder",
    username: `owner_${suffix}`.replace(/[^a-z0-9_]/gi, ""),
    password: "hashed-password-placeholder",
    dateOfBirth: new Date("1980-01-01"),
    bio: "test",
    agreement: true,
    role: "doctor",
    subscriptionPlan: plan,
    trialEndsAt: new Date(0), // пробный истёк — иначе перекроет тариф
  });
}

async function makeClinic(ownerId, tier) {
  counter += 1;
  const { clinic } = await clinicService.createClinic(
    { name: `Клиника ${counter}` },
    ownerId,
  );
  if (tier) {
    await Clinic.updateOne({ _id: clinic._id }, { $set: { tier } });
  }
  return clinic;
}

/** Заполнить штат n действующими членствами. */
async function fillStaff(clinicId, n) {
  await ClinicMembership.insertMany(
    Array.from({ length: n }, () => ({
      userId: new mongoose.Types.ObjectId(),
      clinicId,
      role: "doctor",
      isActive: true,
      joinedAt: new Date(),
    })),
  );
}

describe("определение тарифа клиники", () => {
  it("берёт тариф владельца: именно так выглядит оплата", async () => {
    const owner = await makeOwner("clinic");
    const clinic = await makeClinic(owner._id, "starter");

    // Документ клиники говорит "starter", владелец оплатил Business.
    // Верить надо оплате, иначе купленный тариф не действует.
    expect(await resolveClinicPlan(clinic._id)).toBe("clinic");
  });

  it("если владелец не на клиническом тарифе — читает Clinic.tier", async () => {
    const owner = await makeOwner("doctor_pro");
    const clinic = await makeClinic(owner._id, "enterprise");

    expect(await resolveClinicPlan(clinic._id)).toBe("clinic_pro");
  });

  it("medical_tourism приравнен к Business: в прайсе его нет", async () => {
    const owner = await makeOwner("doctor_pro");
    const clinic = await makeClinic(owner._id, "medical_tourism");

    expect(await resolveClinicPlan(clinic._id)).toBe("clinic");
  });
});

describe("предел штата клиники", () => {
  it("в пределах тарифа добавление разрешено", async () => {
    const owner = await makeOwner("clinic_start");
    const clinic = await makeClinic(owner._id);
    await fillStaff(clinic._id, 2);

    await expect(assertStaffLimit(clinic._id)).resolves.toBeUndefined();
  });

  it("на пределе отказывает и называет тариф с текущим числом", async () => {
    const owner = await makeOwner("clinic_start");
    const clinic = await makeClinic(owner._id);
    const limit = PLAN_LIMITS.clinic_start.doctors;
    await fillStaff(clinic._id, limit);

    await expect(assertStaffLimit(clinic._id)).rejects.toThrow(
      new RegExp(String(limit)),
    );
  });

  it("старший тариф на том же штате работает", async () => {
    const owner = await makeOwner("clinic");
    const clinic = await makeClinic(owner._id);
    await fillStaff(clinic._id, PLAN_LIMITS.clinic_start.doctors);

    await expect(assertStaffLimit(clinic._id)).resolves.toBeUndefined();
  });

  it("уволенные место не занимают — иначе клиника с текучкой упрётся зря", async () => {
    const owner = await makeOwner("clinic_start");
    const clinic = await makeClinic(owner._id);
    const limit = PLAN_LIMITS.clinic_start.doctors;
    await fillStaff(clinic._id, limit);
    await ClinicMembership.updateMany(
      { clinicId: clinic._id },
      { $set: { leftAt: new Date() } },
    );

    await expect(assertStaffLimit(clinic._id)).resolves.toBeUndefined();
  });

  it("несуществующая клиника предел не применяет, а не падает", async () => {
    const ghost = new mongoose.Types.ObjectId();
    expect(await clinicDoctorLimit(ghost)).toBeNull();
    await expect(assertStaffLimit(ghost)).resolves.toBeUndefined();
  });
});
