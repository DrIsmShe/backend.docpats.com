// Запись с витрины: свободное время врача и заявка на приём.
//
// Главное здесь — ГЕЙТЫ, потому что оба эндпоинта публичные:
//   • клиника должна быть опубликована;
//   • врач — действительно работать в НЕЙ, иначе адрес чужой клиники показывал
//     бы расписание постороннего специалиста и принимал заявки от её имени;
//   • слот перепроверяется на сервере: список у посетителя мог устареть.
//
// И отдельно: заявка НЕ создаёт приём. Аноним не занимает календарь врача —
// иначе один скрипт забил бы расписание клиники на месяц вперёд.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";

import { createTestDoctor } from "../helpers/createTestUser.js";
import Clinic from "../../modules/clinic/clinic-core/models/clinic.model.js";
import ClinicMembership from "../../modules/clinic/clinic-staff/models/clinicMembership.model.js";
import DoctorProfile from "../../common/models/DoctorProfile/profileDoctor.js";
import Lead from "../../modules/clinic/clinic-leads/models/lead.model.js";
import ClinicAppointment from "../../modules/clinic/clinic-appointments/models/clinicAppointment.model.js";
import {
  getPublicDoctorSlots,
  createPublicBooking,
} from "../../modules/clinic/clinic-public/clinic-public-booking.service.js";

async function seedClinicWithDoctor({ slug = "test-clinic", isPublished = true } = {}) {
  const { userId } = await createTestDoctor();

  const profile = await DoctorProfile.create({
    userId,
    // phoneHash уникален и не sparse — второму профилю нужно своё значение.
    phoneHash: `hash-${new mongoose.Types.ObjectId()}`,
  });

  const clinic = await Clinic.create({
    name: "Тестовая клиника",
    slug,
    ownerId: userId,
    isPublished,
    isActive: true,
  });

  await ClinicMembership.create({
    userId,
    clinicId: clinic._id,
    role: "doctor",
    actorType: "user",
    isActive: true,
    leftAt: null,
  });

  return { clinic, profile, userId };
}

const RANGE = { from: "2026-09-01", to: "2026-09-03" };

describe("витрина: свободное время врача", () => {
  it("врач без расписания отдаёт пустые дни, а не ошибку", async () => {
    const { clinic, profile } = await seedClinicWithDoctor();

    const slots = await getPublicDoctorSlots(clinic.slug, profile._id, RANGE);

    expect(slots).toBeTruthy();
    expect(Array.isArray(slots.days)).toBe(true);
    for (const day of slots.days) expect(day.slots).toEqual([]);
  });

  it("врача чужой клиники по её адресу не показывает", async () => {
    const mine = await seedClinicWithDoctor({ slug: "clinic-a" });
    const foreign = await seedClinicWithDoctor({ slug: "clinic-b" });

    const slots = await getPublicDoctorSlots(
      mine.clinic.slug,
      foreign.profile._id,
      RANGE,
    );

    expect(slots).toBeNull();
  });

  it("скрытая клиника расписания не отдаёт", async () => {
    const { clinic, profile } = await seedClinicWithDoctor({ isPublished: false });

    expect(await getPublicDoctorSlots(clinic.slug, profile._id, RANGE)).toBeNull();
  });

  it("битый идентификатор врача — null, а не падение", async () => {
    const { clinic } = await seedClinicWithDoctor();

    expect(await getPublicDoctorSlots(clinic.slug, "не-objectid", RANGE)).toBeNull();
  });
});

describe("витрина: заявка на запись", () => {
  const future = () => new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

  it("не принимает время, которого нет в расписании врача", async () => {
    // У врача расписания нет вовсе, значит свободных слотов тоже — любая
    // заявка должна отвергаться, даже с корректными контактами.
    const { clinic, profile } = await seedClinicWithDoctor();

    await expect(
      createPublicBooking(clinic.slug, profile._id, {
        name: "Ләмия",
        phone: "+994501234567",
        startUTC: future(),
      }),
    ).rejects.toThrow(/no longer available/i);
  });

  it("не принимает заявку без имени и телефона", async () => {
    const { clinic, profile } = await seedClinicWithDoctor();

    await expect(
      createPublicBooking(clinic.slug, profile._id, { startUTC: future() }),
    ).rejects.toThrow(/name is required/i);

    await expect(
      createPublicBooking(clinic.slug, profile._id, {
        name: "Ләмия",
        startUTC: future(),
      }),
    ).rejects.toThrow(/phone is required/i);
  });

  it("не принимает время в прошлом", async () => {
    const { clinic, profile } = await seedClinicWithDoctor();

    await expect(
      createPublicBooking(clinic.slug, profile._id, {
        name: "Ләмия",
        phone: "+994501234567",
        startUTC: new Date(Date.now() - 3600 * 1000).toISOString(),
      }),
    ).rejects.toThrow(/in the past/i);
  });

  it("чужому врачу заявку не оформляет", async () => {
    const mine = await seedClinicWithDoctor({ slug: "clinic-a" });
    const foreign = await seedClinicWithDoctor({ slug: "clinic-b" });

    const res = await createPublicBooking(mine.clinic.slug, foreign.profile._id, {
      name: "Ләмия",
      phone: "+994501234567",
      startUTC: future(),
    });

    expect(res).toBeNull();
  });

  it("приём анонимом не создаётся ни при каких условиях", async () => {
    const { clinic, profile } = await seedClinicWithDoctor();

    await createPublicBooking(clinic.slug, profile._id, {
      name: "Ләмия",
      phone: "+994501234567",
      startUTC: future(),
    }).catch(() => {});

    // Календарь врача остаётся пустым: заявка — это пожелание, а не бронь.
    const appointments = await ClinicAppointment.find({})
      .setOptions({ skipTenantScope: true })
      .lean();
    expect(appointments).toHaveLength(0);

    const leads = await Lead.find({}).setOptions({ skipTenantScope: true }).lean();
    expect(leads.filter((l) => l.type === "booking")).toHaveLength(0);
  });
});
