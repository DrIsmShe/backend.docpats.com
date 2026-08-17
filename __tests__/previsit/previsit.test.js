// __tests__/previsit/previsit.test.js
//
// Опрос пациента перед приёмом.
//
// Главное, что здесь проверяется: ОТВЕТЫ НЕ ТЕРЯЮТСЯ. Анкету заполняет
// человек, потративший на неё пять минут своего вечера. Потерять его
// рассказ из-за исчерпанной квоты клиники или недоступной модели —
// значит наказать пациента за расчёты между нами и клиникой.

import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

let composeShouldFail = false;
const composeCalls = { n: 0 };

vi.mock("../../modules/previsit/ai/intakeComposer.js", () => ({
  PROMPT_VERSION: "test-previsit",
  composeIntake: vi.fn(async () => {
    composeCalls.n += 1;
    if (composeShouldFail) throw new Error("модель недоступна");
    return {
      narrative: "Жалобы на головную боль в течение нескольких дней.",
      clarify: ["Уточнить характер боли"],
      model: "test-model",
      promptVersion: "test-previsit",
    };
  }),
}));

const svc = await import("../../modules/previsit/services/previsit.service.js");
const PrevisitIntake = (
  await import("../../modules/previsit/models/previsitIntake.model.js")
).default;
const ClinicAppointment = (
  await import(
    "../../modules/clinic/clinic-appointments/models/clinicAppointment.model.js"
  )
).default;
const { createTestDoctor } = await import("../helpers/createTestUser.js");

const oid = () => new mongoose.Types.ObjectId();

/** Приём через модель напрямую: сервис записи требует полного контекста. */
async function makeAppointment(doctorId) {
  const start = new Date(Date.now() + 3 * 864e5);
  return ClinicAppointment.create({
    clinicId: oid(),
    doctorId,
    patientId: oid(),
    startUTC: start,
    endUTC: new Date(start.getTime() + 30 * 60000),
    localDate: start.toISOString().slice(0, 10),
    startMinute: 600,
    endMinute: 630,
    status: "scheduled",
    createdBy: { actorType: "user", actorId: doctorId, role: "doctor" },
  });
}

const GOOD_ANSWERS = {
  complaint: "Болит голова, особенно к вечеру",
  since: "days",
  dynamics: "worse",
  medications: "Цитрамон",
  redFlags: [],
};

describe("опрос перед приёмом", () => {
  let doctorId;
  let appointment;

  beforeEach(async () => {
    composeShouldFail = false;
    composeCalls.n = 0;
    const { user } = await createTestDoctor({
      subscriptionPlan: "doctor_pro",
      subscriptionEndsAt: new Date(Date.now() + 30 * 864e5),
    });
    doctorId = user._id;
    appointment = await makeAppointment(doctorId);
  });

  it("приглашение создаёт анкету и подписанную ссылку", async () => {
    const invite = await svc.inviteToIntake({
      appointmentId: appointment._id,
    });

    expect(invite.token).toBeTruthy();
    const seen = await svc.getIntakeByToken(invite.token);
    expect(seen.status).toBe("invited");
    // Вопросы приходят с сервера: клиент не должен носить свою копию,
    // которая однажды разойдётся с серверной.
    expect(seen.questions.length).toBeGreaterThan(3);
  });

  it("повторное приглашение не создаёт вторую анкету", async () => {
    await svc.inviteToIntake({ appointmentId: appointment._id });
    await svc.inviteToIntake({ appointmentId: appointment._id });
    expect(await PrevisitIntake.countDocuments()).toBe(1);
  });

  it("заполненная анкета попадает врачу вместе с разбором", async () => {
    const { token } = await svc.inviteToIntake({
      appointmentId: appointment._id,
    });
    await svc.submitIntake({ token, answers: GOOD_ANSWERS });

    const forDoctor = await svc.getIntakeForAppointment({
      appointmentId: appointment._id,
    });

    expect(forDoctor.narrative).toMatch(/головную боль/);
    expect(forDoctor.clarify).toHaveLength(1);
    // Исходные ответы отдаются ВСЕГДА: врач должен иметь возможность
    // прочитать слова пациента, а не только наш пересказ.
    expect(forDoctor.answers.length).toBeGreaterThan(0);
    expect(forDoctor.answers[0].value).toMatch(/Болит голова/);
  });

  it("СБОЙ МОДЕЛИ НЕ ТЕРЯЕТ ОТВЕТЫ", async () => {
    composeShouldFail = true;
    const { token } = await svc.inviteToIntake({
      appointmentId: appointment._id,
    });

    await svc.submitIntake({ token, answers: GOOD_ANSWERS });

    const forDoctor = await svc.getIntakeForAppointment({
      appointmentId: appointment._id,
    });
    // Разбора нет — но рассказ пациента на месте, и приём он не сорвёт.
    expect(forDoctor.narrative).toBe("");
    expect(forDoctor.answers.length).toBeGreaterThan(0);
  });

  it("исчерпанная квота врача тоже не теряет ответы", async () => {
    // Врач на бесплатном уровне: пять разборов в 30 дней.
    const { user: freeDoc } = await createTestDoctor({
      trialEndsAt: new Date(Date.now() - 864e5),
    });
    const appt = await makeAppointment(freeDoc._id);
    const { token } = await svc.inviteToIntake({ appointmentId: appt._id });

    // Забиваем окно уже разобранными анкетами.
    for (let i = 0; i < 5; i += 1) {
      await PrevisitIntake.create({
        appointmentId: oid(),
        clinicId: oid(),
        patientId: oid(),
        doctorId: freeDoc._id,
        status: "submitted",
        narrative: "разобрано",
        submittedAt: new Date(),
      });
    }

    await svc.submitIntake({ token, answers: GOOD_ANSWERS });

    const forDoctor = await svc.getIntakeForAppointment({
      appointmentId: appt._id,
    });
    expect(forDoctor.answers.length).toBeGreaterThan(0);
    expect(forDoctor.narrative).toBe("");
  });

  it("тревожные признаки считаются кодом, а не вылавливаются из текста", async () => {
    const { token } = await svc.inviteToIntake({
      appointmentId: appointment._id,
    });

    const out = await svc.submitIntake({
      token,
      answers: { ...GOOD_ANSWERS, redFlags: ["chest_pain", "fever"] },
    });

    // Боль в груди — срочно, температура — нет. Пациенту говорим сразу,
    // не дожидаясь приёма.
    expect(out.urgent).toEqual(["Боль в груди"]);

    const forDoctor = await svc.getIntakeForAppointment({
      appointmentId: appointment._id,
    });
    expect(forDoctor.redFlags.find((f) => f.value === "chest_pain").urgent).toBe(
      true,
    );
    expect(forDoctor.redFlags.find((f) => f.value === "fever").urgent).toBe(
      false,
    );
  });

  it("без обязательного ответа анкета не принимается", async () => {
    const { token } = await svc.inviteToIntake({
      appointmentId: appointment._id,
    });

    await expect(
      svc.submitIntake({ token, answers: { since: "days" } }),
    ).rejects.toThrow(/Что вас беспокоит/);
  });

  it("подделанный токен не открывает анкету", async () => {
    await expect(svc.getIntakeByToken("не-токен")).rejects.toThrow(
      /недействительна/i,
    );
  });

  it("незаполненная анкета врачу не показывается", async () => {
    await svc.inviteToIntake({ appointmentId: appointment._id });
    const forDoctor = await svc.getIntakeForAppointment({
      appointmentId: appointment._id,
    });
    // Пустая анкета в карте выглядела бы как «пациент ничего не сказал»,
    // хотя его просто не спросили.
    expect(forDoctor).toBeNull();
  });
});
