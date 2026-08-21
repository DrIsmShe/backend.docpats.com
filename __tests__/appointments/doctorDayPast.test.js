// __tests__/appointments/doctorDayPast.test.js
//
// День врача в прошлом: смотреть можно, менять нельзя.
//
// Врач приходит в прошлый месяц с вопросом «кто у меня был». Раньше он
// получал пустой день с двух сторон сразу: календарь в кабинете вообще не
// пускал в прошлое (minDate), а сам эндпоинт отдавал только живые записи —
// pending/confirmed и не в архиве. Приёмы старше семи дней уходят в архив
// автоматически (jobs/autoCleanAppointments.js), то есть прошлый месяц был
// пуст всегда.
//
// Правило теперь разное для двух половин времени:
//   прошлое  — показываем всё, включая архив и завершённые;
//   будущее  — только живые записи, иначе отменённая запись держала бы слот.

import { describe, it, expect, beforeEach } from "vitest";
import DoctorProfile from "../../common/models/DoctorProfile/profileDoctor.js";
import DoctorSchedule from "../../common/models/Appointment/doctorSchedule.js";
import Appointment from "../../common/models/Appointment/appointment.js";
import { getDoctorDayController } from "../../modules/doctorSchedule/controllers/getDoctorDayController.js";
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

/** 09:00 по Баку на указанную дату. */
function at9(date) {
  return new Date(`${date}T09:00:00+04:00`);
}

async function createAppointment(date, extra) {
  const startsAt = at9(date);
  return Appointment.create({
    doctorId: profile._id,
    doctorIdUser: doctor.userId,
    patientId: patient.userId,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 20 * 60000),
    type: "offline",
    channel: "internal",
    ...extra,
  });
}

async function day(date) {
  const res = mockRes();
  await getDoctorDayController(
    { userId: doctor.userId, params: { date }, query: {} },
    res,
  );
  return res.body;
}

function slotAt9(body, date) {
  const wanted = at9(date).getTime();
  return body.slots.find((s) => new Date(s.start).getTime() === wanted);
}

describe("день врача в прошлом", () => {
  it("состоявшийся приём месячной давности виден, даже уйдя в архив", async () => {
    const date = dateInDays(-30);
    await createAppointment(date, { status: "completed", isArchived: true });

    const body = await day(date);
    const slot = slotAt9(body, date);

    expect(slot.status).toBe("busy");
    expect(slot.appointment.status).toBe("completed");
    expect(slot.appointment.patient?.name).toBeTruthy();
  });

  it("отменённый приём в прошлом тоже виден — это часть ответа «кто был»", async () => {
    const date = dateInDays(-3);
    await createAppointment(date, { status: "cancelled" });

    const slot = slotAt9(await day(date), date);
    expect(slot.status).toBe("busy");
    expect(slot.appointment.status).toBe("cancelled");
  });

  it("в будущем отменённая запись слот НЕ держит", async () => {
    const date = dateInDays(2);
    await createAppointment(date, { status: "cancelled" });

    const slot = slotAt9(await day(date), date);
    expect(slot.status).toBe("free");
  });

  it("в будущем архивная запись слот НЕ держит", async () => {
    const date = dateInDays(2);
    await createAppointment(date, { status: "confirmed", isArchived: true });

    const slot = slotAt9(await day(date), date);
    expect(slot.status).toBe("free");
  });

  it("живая запись в будущем занимает слот, как и раньше", async () => {
    const date = dateInDays(2);
    await createAppointment(date, { status: "confirmed" });

    const slot = slotAt9(await day(date), date);
    expect(slot.status).toBe("busy");
  });
});
