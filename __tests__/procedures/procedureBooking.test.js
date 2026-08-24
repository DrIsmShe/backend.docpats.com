// __tests__/procedures/procedureBooking.test.js
//
// Запись на операцию и обследование — отдельная сущность.
//
// Проверяется то, ради чего она отдельная, а не то, что «создаётся документ»:
//   * длительность в часах, а не слот сетки;
//   * занятость считается ВМЕСТЕ с приёмами — врач не может одновременно
//     оперировать и вести приём;
//   * перенос сохраняет историю, а не перезаписывает время;
//   * закрытый граф статусов: завершённое не отменяется.

import { describe, it, expect, beforeEach } from "vitest";
import DoctorProfile from "../../common/models/DoctorProfile/profileDoctor.js";
import DoctorSchedule from "../../common/models/Appointment/doctorSchedule.js";
import Appointment from "../../common/models/Appointment/appointment.js";
import ProcedureBooking from "../../common/models/Procedure/procedureBooking.js";
import DoctorPrivatePatient from "../../common/models/Polyclinic/DoctorPrivatePatient.js";
import createProcedureController from "../../modules/procedures/controllers/createProcedureController.js";
import {
  listProceduresController,
  getProcedureDayController,
} from "../../modules/procedures/controllers/listProceduresController.js";
import {
  updateProcedureStatusController,
  postponeProcedureController,
  archiveProcedureController,
} from "../../modules/procedures/controllers/updateProcedureController.js";
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
    weekly: [],
  });
});

// ФИО у DoctorPrivatePatient обязательно и шифруется виртуалами —
// просто Model.create({doctorProfileId}) не проходит валидацию.
let cardSeq = 0;
async function makeCard() {
  const card = new DoctorPrivatePatient({
    doctorProfileId: profile._id,
    doctorUserId: doctor.userId,
  });
  card.firstName = "Сосед";
  card.lastName = `По приёму ${++cardSeq}`;
  await card.save();
  return card;
}

/** Момент через N часов от текущего — заведомо в будущем. */
function inHours(n) {
  return new Date(Date.now() + n * 3600000);
}

/**
 * Фиксированный час по Баку (UTC+4) через N суток.
 *
 * Нужен там, где проверяется ГРАНИЦА СУТОК: inHours() привязан к
 * текущему времени, и тест, ставящий второе событие на +3 часа, после
 * 21:00 по Баку уезжает в следующие сутки и падает раз в день — причём
 * вечером, когда его никто не смотрит.
 */
function atBakuHour(daysAhead, hour) {
  const utc = new Date(Date.now() + daysAhead * 86400000);
  // Баку = UTC+4 круглый год, перевода часов нет.
  const baku = new Date(utc.getTime() + 4 * 3600000);
  const ymd = baku.toISOString().slice(0, 10);
  return {
    date: ymd,
    at: new Date(`${ymd}T${String(hour).padStart(2, "0")}:00:00+04:00`),
  };
}

function req(body, params = {}) {
  return {
    userId: doctor.userId,
    user: doctor.user,
    body,
    params,
    query: {},
    headers: {},
    method: "POST",
    originalUrl: "/procedures",
  };
}

const NEW_PATIENT = {
  kind: "new",
  firstName: "Иван",
  lastName: "Петров",
  phone: "+994501112233",
};

async function create(overrides = {}) {
  const res = mockRes();
  await createProcedureController(
    req({
      kind: "surgery",
      title: "Септопластика",
      startsAt: inHours(48).toISOString(),
      durationMin: 90,
      patient: NEW_PATIENT,
      ...overrides,
    }),
    res,
  );
  return res;
}

describe("запись на операцию и обследование", () => {
  it("создаётся с длительностью в часах, а не слотом сетки", async () => {
    const res = await create({ durationMin: 180 });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.procedure.kind).toBe("surgery");
    expect(res.body.procedure.durationMin).toBe(180);
    expect(res.body.procedure.status).toBe("planned");
    // Пациента завели тут же — как и в записи на приём.
    expect(res.body.procedure.patient.name).toContain("Иван");
    expect(await DoctorPrivatePatient.countDocuments()).toBe(1);
  });

  it("обследование — тот же поток, другой вид", async () => {
    const res = await create({
      kind: "examination",
      title: "МРТ головного мозга",
      durationMin: 45,
      fasting: true,
      preparation: "Не есть за 6 часов",
    });

    expect(res.statusCode).toBe(201);
    expect(res.body.procedure.kind).toBe("examination");
    expect(res.body.procedure.fasting).toBe(true);
    expect(res.body.procedure.preparation).toBe("Не есть за 6 часов");
  });

  it("вид, отличный от операции и обследования, не принимается", async () => {
    const res = await create({ kind: "приём" });
    expect(res.statusCode).toBe(400);
  });

  it("на прошедшее время записать нельзя", async () => {
    const res = await create({ startsAt: inHours(-5).toISOString() });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("PAST_TIME");
  });

  it("длительность вне разумных границ отклоняется", async () => {
    expect((await create({ durationMin: 5 })).statusCode).toBe(400);
    expect((await create({ durationMin: 60 * 30 })).statusCode).toBe(400);
  });

  // ─── Главное: занятость считается по двум коллекциям ───────────────

  it("время, занятое ПРИЁМОМ, для операции недоступно", async () => {
    const starts = inHours(48);
    await Appointment.create({
      doctorId: profile._id,
      doctorIdUser: doctor.userId,
      privatePatientId: (await makeCard())._id,
      startsAt: starts,
      endsAt: new Date(starts.getTime() + 20 * 60000),
      status: "confirmed",
      createdBy: doctor.userId,
    });

    const res = await create({ startsAt: starts.toISOString() });

    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("SLOT_TAKEN_APPOINTMENT");
  });

  it("операция занимает время и для второй операции", async () => {
    const starts = inHours(48);
    await create({ startsAt: starts.toISOString(), durationMin: 120 });

    // Начало внутри первой — пересечение, а не совпадение начала: именно то,
    // что уникальный индекс НЕ ловит.
    const res = await create({
      startsAt: new Date(starts.getTime() + 30 * 60000).toISOString(),
      durationMin: 60,
    });

    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("SLOT_TAKEN_PROCEDURE");
  });

  it("отменённая операция время больше не держит", async () => {
    const starts = inHours(48);
    const first = await create({ startsAt: starts.toISOString() });

    const cancel = mockRes();
    await updateProcedureStatusController(
      req({ status: "cancelled", cancelReason: "пациент отказался" }, {
        id: first.body.procedure._id,
      }),
      cancel,
    );
    expect(cancel.statusCode).toBe(200);

    const again = await create({ startsAt: starts.toISOString() });
    expect(again.statusCode).toBe(201);
  });

  // ─── День врача ─────────────────────────────────────────────────────

  it("день врача показывает и вмешательства, и занятость приёмами", async () => {
    // Жёсткий час по Баку: оба события обязаны остаться в ОДНИХ сутках.
    const { date, at: starts } = atBakuHour(2, 9);
    await create({ startsAt: starts.toISOString(), durationMin: 60 });
    await Appointment.create({
      doctorId: profile._id,
      doctorIdUser: doctor.userId,
      privatePatientId: (await makeCard())._id,
      startsAt: new Date(starts.getTime() + 3 * 3600000),
      endsAt: new Date(starts.getTime() + 3 * 3600000 + 20 * 60000),
      status: "confirmed",
      createdBy: doctor.userId,
    });

    const res = mockRes();
    await getProcedureDayController(req({}, { date }), res);

    expect(res.body.success).toBe(true);
    expect(res.body.procedures).toHaveLength(1);
    expect(res.body.busy).toHaveLength(1);
    expect(res.body.busy[0].source).toBe("appointment");
    // Занятость приёмом отдаётся БЕЗ пациента — это чужие данные.
    expect(res.body.busy[0]).not.toHaveProperty("patient");
  });

  // ─── Перенос ────────────────────────────────────────────────────────

  it("перенос создаёт новую запись и сохраняет ссылку со старой", async () => {
    const first = await create({ startsAt: inHours(48).toISOString() });
    const oldId = first.body.procedure._id;

    const res = mockRes();
    await postponeProcedureController(
      req(
        { startsAt: inHours(72).toISOString(), reason: "перенос по просьбе" },
        { id: oldId },
      ),
      res,
    );

    expect(res.statusCode).toBe(201);
    const newId = res.body.procedure._id;
    expect(newId).not.toBe(oldId);

    const old = await ProcedureBooking.findById(oldId).lean();
    expect(old.status).toBe("postponed");
    expect(String(old.postponedToId)).toBe(newId);
    // Время старой записи НЕ переписано — иначе история переносов теряется.
    expect(new Date(old.startsAt).getTime()).toBeLessThan(
      new Date(res.body.procedure.startsAt).getTime(),
    );
  });

  it("перенос освобождает прежнее время", async () => {
    const starts = inHours(48);
    const first = await create({ startsAt: starts.toISOString() });

    const moved = mockRes();
    await postponeProcedureController(
      req({ startsAt: inHours(72).toISOString() }, {
        id: first.body.procedure._id,
      }),
      moved,
    );
    expect(moved.statusCode).toBe(201);

    const again = await create({ startsAt: starts.toISOString() });
    expect(again.statusCode).toBe(201);
  });

  it("перенос на занятое время отклоняется, старая запись остаётся живой", async () => {
    const busyAt = inHours(72);
    await create({ startsAt: busyAt.toISOString(), durationMin: 60 });
    const target = await create({ startsAt: inHours(48).toISOString() });

    const res = mockRes();
    await postponeProcedureController(
      req({ startsAt: busyAt.toISOString() }, { id: target.body.procedure._id }),
      res,
    );

    expect(res.statusCode).toBe(409);
    // Именно ИСХОДНЫЙ статус, а не «любой активный»: неудавшийся
    // перенос не должен повышать запись до подтверждённой.
    const still = await ProcedureBooking.findById(
      target.body.procedure._id,
    ).lean();
    expect(still.status).toBe("planned");
  });

  // ─── Статусы ────────────────────────────────────────────────────────

  it("завершённую операцию отменить нельзя", async () => {
    const created = await create();
    const id = created.body.procedure._id;

    const done = mockRes();
    await updateProcedureStatusController(
      req({ status: "completed" }, { id }),
      done,
    );
    expect(done.statusCode).toBe(200);

    const undo = mockRes();
    await updateProcedureStatusController(
      req({ status: "cancelled" }, { id }),
      undo,
    );
    expect(undo.statusCode).toBe(409);
    expect(undo.body.code).toBe("BAD_TRANSITION");
  });

  it("«перенесено» нельзя поставить сменой статуса — только переносом", async () => {
    const created = await create();
    const res = mockRes();
    await updateProcedureStatusController(
      req({ status: "postponed" }, { id: created.body.procedure._id }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("USE_POSTPONE");
  });

  // ─── Чужое ──────────────────────────────────────────────────────────

  it("чужую запись править нельзя", async () => {
    const created = await create();

    const other = await createTestDoctor();
    // Телефон явно: phoneHash объявлен unique + sparse, но рядом стоит
    // `default: null`, а sparse пропускает только ОТСУТСТВУЮЩЕЕ поле.
    await DoctorProfile.create({
      userId: other.userId,
      phoneNumber: "+994505559911",
    });

    const res = mockRes();
    await updateProcedureStatusController(
      {
        userId: other.userId,
        user: other.user,
        body: { status: "completed" },
        params: { id: created.body.procedure._id },
        headers: {},
        method: "PATCH",
        originalUrl: "/procedures",
      },
      res,
    );

    expect(res.statusCode).toBe(404);
  });

  it("список отдаёт только свои записи и умеет фильтровать по виду", async () => {
    await create({ kind: "surgery", startsAt: inHours(48).toISOString() });
    await create({
      kind: "examination",
      title: "УЗИ",
      startsAt: inHours(96).toISOString(),
      durationMin: 30,
    });

    const res = mockRes();
    await listProceduresController(
      { userId: doctor.userId, query: { kind: "examination" }, headers: {} },
      res,
    );

    expect(res.body.procedures).toHaveLength(1);
    expect(res.body.procedures[0].title).toBe("УЗИ");
  });

  // ─── Архив ──────────────────────────────────────────────────────────

  it("активную запись в архив убрать нельзя", async () => {
    const created = await create();
    const res = mockRes();
    await archiveProcedureController(
      req({ archived: true }, { id: created.body.procedure._id }),
      res,
    );
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("STILL_ACTIVE");
  });

  it("завершённая запись в архив убирается и пропадает из списка", async () => {
    const created = await create();
    const id = created.body.procedure._id;

    const done = mockRes();
    await updateProcedureStatusController(
      req({ status: "completed" }, { id }),
      done,
    );

    const arch = mockRes();
    await archiveProcedureController(req({ archived: true }, { id }), arch);
    expect(arch.statusCode).toBe(200);

    const list = mockRes();
    await listProceduresController(
      { userId: doctor.userId, query: {}, headers: {} },
      list,
    );
    expect(list.body.procedures).toHaveLength(0);
  });
});
