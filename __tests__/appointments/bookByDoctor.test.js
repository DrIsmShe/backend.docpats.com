// __tests__/appointments/bookByDoctor.test.js
//
// Врач записывает пациента сам: три вида пациента, занятость слота, защита
// чужих карточек и запись вне сетки расписания.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import DoctorProfile from "../../common/models/DoctorProfile/profileDoctor.js";
import DoctorSchedule from "../../common/models/Appointment/doctorSchedule.js";
import Appointment from "../../common/models/Appointment/appointment.js";
import DoctorPrivatePatient from "../../common/models/Polyclinic/DoctorPrivatePatient.js";
import Notification from "../../common/models/Notification/notification.js";
import { bookByDoctorController } from "../../modules/doctorSchedule/controllers/bookByDoctorController.js";
import { getDoctorDayController } from "../../modules/doctorSchedule/controllers/getDoctorDayController.js";
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

// Расписание: понедельник–воскресенье 09:00–13:00, слот 20 минут, зона Баку.
// Каждый день недели заполнен намеренно — тест не должен зависеть от того,
// на какой день выпал «завтра».
function weeklyAllDays() {
  return [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
    dow,
    intervals: [
      { start: "09:00", end: "13:00", slotMinutes: 20, type: "offline" },
    ],
  }));
}

let doctor;
let profile;

beforeEach(async () => {
  doctor = await createTestDoctor();
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

/** Дата через N дней в формате YYYY-MM-DD по зоне Баку. */
function dateInDays(n) {
  const d = new Date(Date.now() + n * 86400000);
  // Баку = UTC+4 круглый год, поэтому смещение считаем явно.
  const baku = new Date(d.getTime() + 4 * 3600000);
  return baku.toISOString().slice(0, 10);
}

async function daySlots(date) {
  const res = mockRes();
  await getDoctorDayController(
    { userId: doctor.userId, params: { date }, query: {} },
    res,
  );
  return res.body;
}

function bookReq(body) {
  return {
    userId: doctor.userId,
    user: doctor.user,
    body,
    headers: {},
    method: "POST",
    originalUrl: "/schedule/appointment/book-by-doctor",
  };
}

describe("запись пациента врачом", () => {
  it("день врача отдаёт слоты расписания, а не выдуманные часы", async () => {
    const date = dateInDays(2);
    const body = await daySlots(date);

    expect(body.success).toBe(true);
    expect(body.timezone).toBe("Asia/Baku");
    // 09:00–13:00 по 20 минут = 12 слотов.
    expect(body.slots).toHaveLength(12);
    expect(body.slots.every((s) => s.status === "free")).toBe(true);
  });

  it("записывает зарегистрированного пациента и уведомляет его", async () => {
    const patient = await createTestDoctor({
      role: "patient",
      isDoctor: false,
      isPatient: true,
    });
    const date = dateInDays(2);
    const { slots } = await daySlots(date);

    const res = mockRes();
    await bookByDoctorController(
      bookReq({
        startsAt: slots[0].start,
        endsAt: slots[0].end,
        type: "offline",
        patient: { kind: "registered", id: String(patient.userId) },
      }),
      res,
    );

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.notified).toBe(true);

    const appt = await Appointment.findOne({ doctorId: profile._id });
    expect(String(appt.patientId)).toBe(String(patient.userId));
    expect(appt.status).toBe("confirmed");
    expect(appt.bookedBy).toBe("doctor");
    expect(appt.offSchedule).toBe(false);

    const notes = await Notification.find({
      userId: patient.userId,
      type: "appointment_booked_by_doctor",
    });
    expect(notes).toHaveLength(1);
  });

  it("заводит нового пациента прямо из формы — карточка и приём", async () => {
    const date = dateInDays(2);
    const { slots } = await daySlots(date);

    const res = mockRes();
    await bookByDoctorController(
      bookReq({
        startsAt: slots[1].start,
        type: "offline",
        patient: {
          kind: "new",
          firstName: "Иван",
          lastName: "Петров",
          phone: "994501234567",
        },
      }),
      res,
    );

    expect(res.statusCode).toBe(201);

    const card = await DoctorPrivatePatient.findOne({
      doctorProfileId: profile._id,
    });
    expect(card).toBeTruthy();
    expect(card.firstName).toBe("Иван");
    // Имя и телефон в базе зашифрованы — открытым текстом их там быть не должно.
    expect(card.firstNameEncrypted).not.toBe("Иван");
    expect(card.phoneHash).toBeTruthy();

    const appt = await Appointment.findOne({ doctorId: profile._id });
    expect(String(appt.privatePatientId)).toBe(String(card._id));
    expect(appt.patientId).toBeNull();
    // Уведомлять некого: аккаунта нет.
    expect(res.body.notified).toBe(false);
  });

  it("второй раз тот же телефон не плодит карточку", async () => {
    const date = dateInDays(2);
    const { slots } = await daySlots(date);

    for (const slot of [slots[2], slots[3]]) {
      const res = mockRes();
      await bookByDoctorController(
        bookReq({
          startsAt: slot.start,
          type: "offline",
          patient: {
            kind: "new",
            firstName: "Иван",
            lastName: "Петров",
            phone: "+994 50 123-45-67",
          },
        }),
        res,
      );
      expect(res.statusCode).toBe(201);
    }

    const cards = await DoctorPrivatePatient.find({
      doctorProfileId: profile._id,
    });
    expect(cards).toHaveLength(1);
    expect(await Appointment.countDocuments({ doctorId: profile._id })).toBe(2);
  });

  it("занятый слот перестаёт быть свободным и повторно не занимается", async () => {
    const date = dateInDays(2);
    const { slots } = await daySlots(date);
    const target = slots[4];

    const first = mockRes();
    await bookByDoctorController(
      bookReq({
        startsAt: target.start,
        endsAt: target.end,
        type: "offline",
        patient: { kind: "new", firstName: "А", lastName: "Б" },
      }),
      first,
    );
    expect(first.statusCode).toBe(201);

    // Тот же слот занят и в дне врача — ровно это увидит и пациент,
    // потому что генератор слотов у них общий.
    const after = await daySlots(date);
    const same = after.slots.find((s) => s.start === target.start);
    expect(same.status).toBe("busy");
    expect(same.appointment.patient.kind).toBe("private");

    const second = mockRes();
    await bookByDoctorController(
      bookReq({
        startsAt: target.start,
        endsAt: target.end,
        type: "offline",
        patient: { kind: "new", firstName: "В", lastName: "Г" },
      }),
      second,
    );
    expect(second.statusCode).toBe(409);
    expect(second.body.code).toBe("SLOT_TAKEN");
  });

  it("занятое врачом время исчезает из слотов, которые видит пациент", async () => {
    const date = dateInDays(2);
    const { slots } = await daySlots(date);
    const target = slots[6];

    const publicSlots = async () => {
      const res = mockRes();
      await getDoctorSlotsPublic(
        {
          params: { date, type: "offline" },
          query: { doctorId: String(profile._id) },
        },
        res,
      );
      return res.body.slots.map((s) => s.start);
    };

    expect(await publicSlots()).toContain(target.start);

    const res = mockRes();
    await bookByDoctorController(
      bookReq({
        startsAt: target.start,
        endsAt: target.end,
        type: "offline",
        patient: { kind: "new", firstName: "С", lastName: "Улицы" },
      }),
      res,
    );
    expect(res.statusCode).toBe(201);

    // Это и есть смысл общей сетки: пациент больше не может выбрать время,
    // которое врач занял у себя в календаре.
    expect(await publicSlots()).not.toContain(target.start);
  });

  it("время вне сетки требует подтверждения, затем помечается", async () => {
    const date = dateInDays(2);

    const denied = mockRes();
    await bookByDoctorController(
      bookReq({
        startsAtLocal: `${date}T20:30`,
        type: "offline",
        patient: { kind: "new", firstName: "Срочный", lastName: "Пациент" },
      }),
      denied,
    );
    expect(denied.statusCode).toBe(409);
    expect(denied.body.code).toBe("OUT_OF_SCHEDULE");
    expect(await Appointment.countDocuments()).toBe(0);

    const allowed = mockRes();
    await bookByDoctorController(
      bookReq({
        startsAtLocal: `${date}T20:30`,
        type: "offline",
        offSchedule: true,
        patient: { kind: "new", firstName: "Срочный", lastName: "Пациент" },
      }),
      allowed,
    );
    expect(allowed.statusCode).toBe(201);

    const appt = await Appointment.findOne({});
    expect(appt.offSchedule).toBe(true);
    // 20:30 в Баку — это 16:30 UTC.
    expect(new Date(appt.startsAt).toISOString()).toContain("16:30");

    // Такой приём виден в дне врача отдельной строкой, иначе «свободный»
    // день оказался бы занятым.
    const day = await daySlots(date);
    const extra = day.slots.find((s) => s.outOfSchedule);
    expect(extra).toBeTruthy();
    expect(extra.status).toBe("busy");
  });

  it("на прошедшее время записать нельзя", async () => {
    const yesterday = dateInDays(-1);

    const res = mockRes();
    await bookByDoctorController(
      bookReq({
        startsAtLocal: `${yesterday}T10:00`,
        type: "offline",
        // Даже с явным согласием на запись вне сетки: вне сетки — это про
        // время, которого нет в расписании, а не про вчерашний день.
        offSchedule: true,
        patient: { kind: "new", firstName: "Вчерашний", lastName: "Пациент" },
      }),
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("PAST_TIME");
    expect(await Appointment.countDocuments()).toBe(0);
  });

  it("только что начавшийся слот записать всё ещё можно", async () => {
    // Пациент уже в кабинете, врач оформляет его текущим временем —
    // ради этого и оставлен пятиминутный допуск.
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

    const res = mockRes();
    await bookByDoctorController(
      bookReq({
        startsAt: twoMinutesAgo.toISOString(),
        type: "offline",
        offSchedule: true,
        patient: { kind: "new", firstName: "Срочный", lastName: "Пациент" },
      }),
      res,
    );

    expect(res.statusCode).toBe(201);
  });

  it("чужую приватную карточку записать нельзя", async () => {
    // Профиль второго врача не создаём: в DoctorProfile висит уникальный
    // индекс по phoneHash, и второй профиль без телефона падает на дубле
    // null. Карточке достаточно чужого doctorProfileId — проверяем именно
    // фильтр по владельцу.
    const otherDoctor = await createTestDoctor();
    const foreign = new DoctorPrivatePatient({
      doctorProfileId: new mongoose.Types.ObjectId(),
      doctorUserId: otherDoctor.userId,
    });
    foreign.firstName = "Чужой";
    foreign.lastName = "Пациент";
    await foreign.save();

    const date = dateInDays(2);
    const { slots } = await daySlots(date);

    const res = mockRes();
    await bookByDoctorController(
      bookReq({
        startsAt: slots[5].start,
        type: "offline",
        patient: { kind: "private", id: String(foreign._id) },
      }),
      res,
    );

    expect(res.statusCode).toBe(404);
    expect(await Appointment.countDocuments()).toBe(0);
  });

  it("приём без пациента не создаётся", async () => {
    const appt = new Appointment({
      doctorId: profile._id,
      doctorIdUser: doctor.userId,
      startsAt: new Date(Date.now() + 86400000),
      endsAt: new Date(Date.now() + 86400000 + 1200000),
    });
    await expect(appt.save()).rejects.toThrow(/patientId or privatePatientId/);
  });

  it("две ссылки на пациента разом — тоже ошибка", async () => {
    const appt = new Appointment({
      doctorId: profile._id,
      doctorIdUser: doctor.userId,
      patientId: new mongoose.Types.ObjectId(),
      privatePatientId: new mongoose.Types.ObjectId(),
      startsAt: new Date(Date.now() + 86400000),
      endsAt: new Date(Date.now() + 86400000 + 1200000),
    });
    await expect(appt.save()).rejects.toThrow(/cannot have both/);
  });
});
