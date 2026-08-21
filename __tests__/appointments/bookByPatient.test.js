// __tests__/appointments/bookByPatient.test.js
//
// Пациент записывается сам. Проверяем ровно то, чего у этого пути не было:
// защиту от записи в прошлое.
//
// Дыра была двойной, поэтому и тестов два уровня:
//   • слоты — прошедшее время предлагалось как свободное (в том числе
//     утренние часы уже идущего дня);
//   • запись — сервер принимал любое startsAt, вплоть до вчерашнего.
// Запись задним числом ломает напоминания (они смотрят только вперёд),
// статистику и сам смысл приёма.

import { describe, it, expect, beforeEach } from "vitest";
import DoctorProfile from "../../common/models/DoctorProfile/profileDoctor.js";
import DoctorSchedule from "../../common/models/Appointment/doctorSchedule.js";
import Appointment from "../../common/models/Appointment/appointment.js";
import { bookAppointment } from "../../modules/patientAppointments/controllers/patientAppointmentsController.js";
import { getDoctorSlotsPublic } from "../../modules/doctorSchedule/controllers/getDoctorSlotsPublic.js";
import { createTestDoctor } from "../helpers/createTestUser.js";

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

// Расписание на все дни недели: тест не должен зависеть от того, на какой
// день выпало «вчера».
function weeklyAllDays() {
  return [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
    dow,
    intervals: [
      { start: "09:00", end: "13:00", slotMinutes: 20, type: "offline" },
    ],
  }));
}

let doctor;
let patient;
let profile;

beforeEach(async () => {
  doctor = await createTestDoctor();
  patient = await createTestDoctor({ role: "patient", isDoctor: false });
  profile = await DoctorProfile.create({
    userId: doctor.userId,
    verificationStatus: "approved",
  });
  await DoctorSchedule.create({
    doctorId: profile._id,
    timezone: "Asia/Baku",
    weekly: weeklyAllDays(),
  });
});

/** Дата через N дней в формате YYYY-MM-DD по зоне Баку (UTC+4 круглый год). */
function dateInDays(n) {
  const d = new Date(Date.now() + n * 86400000 + 4 * 3600000);
  return d.toISOString().slice(0, 10);
}

async function publicSlots(date) {
  const res = mockRes();
  await getDoctorSlotsPublic(
    { params: { date, type: "offline" }, query: { doctorId: profile._id } },
    res,
  );
  return res.body;
}

function bookReq(body) {
  return { userId: patient.userId, body, headers: {} };
}

describe("запись пациента к врачу", () => {
  it("на вчерашний день свободных слотов не остаётся", async () => {
    const body = await publicSlots(dateInDays(-1));
    expect(body.success).toBe(true);
    expect(body.slots).toHaveLength(0);
  });

  it("на завтра слоты по расписанию есть", async () => {
    const body = await publicSlots(dateInDays(1));
    expect(body.slots.length).toBeGreaterThan(0);
  });

  it("сегодняшние слоты — только те, что ещё не наступили", async () => {
    const body = await publicSlots(dateInDays(0));
    for (const s of body.slots) {
      expect(new Date(s.start).getTime()).toBeGreaterThan(Date.now());
    }
  });

  it("запись на прошедшее время отклоняется", async () => {
    const startsAt = new Date(Date.now() - 86400000);
    const endsAt = new Date(startsAt.getTime() + 20 * 60000);

    const res = mockRes();
    await bookAppointment(
      bookReq({
        doctorId: String(profile._id),
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        type: "offline",
      }),
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("PAST_TIME");
    expect(await Appointment.countDocuments()).toBe(0);
  });

  it("запись на будущее создаётся", async () => {
    const startsAt = new Date(Date.now() + 86400000);
    const endsAt = new Date(startsAt.getTime() + 20 * 60000);

    const res = mockRes();
    await bookAppointment(
      bookReq({
        doctorId: String(profile._id),
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        type: "offline",
      }),
      res,
    );

    expect(res.statusCode).toBe(201);
    expect(await Appointment.countDocuments()).toBe(1);
  });

  it("конец приёма раньше начала — тоже отказ", async () => {
    const startsAt = new Date(Date.now() + 86400000);
    const endsAt = new Date(startsAt.getTime() - 60000);

    const res = mockRes();
    await bookAppointment(
      bookReq({
        doctorId: String(profile._id),
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        type: "offline",
      }),
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(await Appointment.countDocuments()).toBe(0);
  });
});
