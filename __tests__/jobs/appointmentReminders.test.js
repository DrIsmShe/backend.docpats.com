// __tests__/jobs/appointmentReminders.test.js
//
// Напоминания о приёме: кому уходят, сколько раз и что происходит с записью,
// созданной впритык.
//
// Главное, что здесь проверяется, — идемпотентность. Задача поднимается каждые
// 5 минут; без отметок на записи один и тот же приём напоминал бы о себе
// двенадцать раз в час, и это худший исход из возможных: человек выключает
// уведомления совсем.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import Appointment from "../../common/models/Appointment/appointment.js";
import Notification from "../../common/models/Notification/notification.js";
import { runAppointmentReminders } from "../../jobs/appointmentReminders.job.js";
import { createTestDoctor } from "../helpers/createTestUser.js";

const MIN = 60 * 1000;

let savedBrevo;
beforeAll(() => {
  // Гарантируем, что реальные письма НЕ уходят (ступень −24ч шлёт e-mail).
  savedBrevo = process.env.BREVO_API_KEY;
  process.env.BREVO_API_KEY = "";
});
afterAll(() => {
  process.env.BREVO_API_KEY = savedBrevo;
});

async function makePair() {
  const doctor = await createTestDoctor();
  const patient = await createTestDoctor({
    role: "patient",
    isDoctor: false,
    isPatient: true,
  });
  return { doctor, patient };
}

async function makeAppointment({ doctor, patient, minutesAhead, ...rest }) {
  const startsAt = new Date(Date.now() + minutesAhead * MIN);
  const endsAt = new Date(startsAt.getTime() + 20 * MIN);
  return Appointment.create({
    // doctorId ссылается на профиль врача — в этом тесте он не читается,
    // достаточно валидного ObjectId.
    doctorId: new mongoose.Types.ObjectId(),
    doctorIdUser: doctor.userId,
    // Запись через /appointment-for-patient/book кладёт в patientId userId
    // пациента — воспроизводим ровно этот, боевой, случай.
    patientId: patient.userId,
    startsAt,
    endsAt,
    type: "video",
    status: "confirmed",
    ...rest,
  });
}

function remindersOf(userId) {
  return Notification.find({
    userId,
    type: "appointment_reminder",
  }).lean();
}

describe("напоминания о приёмах", () => {
  it("за час до приёма уведомляет обе стороны — и врача, и пациента", async () => {
    const { doctor, patient } = await makePair();
    await makeAppointment({ doctor, patient, minutesAhead: 50 });

    const res = await runAppointmentReminders();
    expect(res.sent).toBe(2);

    expect(await remindersOf(patient.userId)).toHaveLength(1);
    expect(await remindersOf(doctor.userId)).toHaveLength(1);
  });

  it("повторный прогон ничего не шлёт — отметка на записи уже стоит", async () => {
    const { doctor, patient } = await makePair();
    await makeAppointment({ doctor, patient, minutesAhead: 50 });

    await runAppointmentReminders();
    const second = await runAppointmentReminders();

    expect(second.sent).toBe(0);
    expect(await remindersOf(patient.userId)).toHaveLength(1);
  });

  it("следующая ступень срабатывает отдельно: −1ч, затем −10мин", async () => {
    const { doctor, patient } = await makePair();
    const appt = await makeAppointment({ doctor, patient, minutesAhead: 50 });

    await runAppointmentReminders(); // ступень «за час»

    // Приближаем приём вплотную — как если бы прошло 45 минут.
    appt.startsAt = new Date(Date.now() + 8 * MIN);
    appt.endsAt = new Date(Date.now() + 28 * MIN);
    await appt.save();

    const res = await runAppointmentReminders();
    expect(res.sent).toBe(2);
    expect(await remindersOf(patient.userId)).toHaveLength(2);
  });

  it("запись впритык не выдаёт три напоминания подряд — только самое срочное", async () => {
    const { doctor, patient } = await makePair();
    // 6 минут до приёма: просрочены сразу все три ступени.
    await makeAppointment({ doctor, patient, minutesAhead: 6 });

    await runAppointmentReminders();

    const got = await remindersOf(patient.userId);
    expect(got).toHaveLength(1);
    expect(got[0].meta.stage).toBe("m10");

    // Остальные ступени закрыты, а не оставлены «на потом».
    const second = await runAppointmentReminders();
    expect(second.sent).toBe(0);
  });

  it("отменённый приём не напоминает о себе", async () => {
    const { doctor, patient } = await makePair();
    await makeAppointment({
      doctor,
      patient,
      minutesAhead: 50,
      status: "cancelled",
    });

    const res = await runAppointmentReminders();
    expect(res.sent).toBe(0);
    expect(await remindersOf(patient.userId)).toHaveLength(0);
  });

  it("прошедший приём не напоминает о себе", async () => {
    const { doctor, patient } = await makePair();
    await makeAppointment({ doctor, patient, minutesAhead: -30 });

    const res = await runAppointmentReminders();
    expect(res.sent).toBe(0);
  });

  it("в тексте напоминания нет причины обращения — пуш виден на заблокированном экране", async () => {
    const { doctor, patient } = await makePair();
    await makeAppointment({
      doctor,
      patient,
      minutesAhead: 50,
      notesPatient: "жалобы на боль в груди",
    });

    await runAppointmentReminders();

    const [n] = await remindersOf(patient.userId);
    expect(n.message).not.toContain("боль");
    // meta — только структура, без PHI (правило модуля audit).
    expect(JSON.stringify(n.meta)).not.toContain("боль");
  });
});
