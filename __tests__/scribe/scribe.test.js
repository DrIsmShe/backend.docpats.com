// __tests__/scribe/scribe.test.js
//
// Запись приёма.
//
// Согласие здесь не бумажное, а техническое: пациент не согласился —
// его браузер не пишет, записи не существует. Проверяем именно это, а
// не то, что где-то выставлен флажок.
//
// Второе по важности — АВТОРСТВО РЕПЛИК. «Я думаю, у меня воспаление
// лёгких» от пациента это жалоба; та же фраза от врача — диагноз.
// Перепутать значит поставить пациенту диагноз, которого врач не
// ставил, поэтому реплики хранятся раздельно и никогда не склеиваются
// в безличный текст.

import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

const stt = { calls: 0 };
vi.mock("../../modules/dictation/providers/stt.provider.js", () => ({
  transcribe: vi.fn(async ({ filename }) => {
    stt.calls += 1;
    return {
      text: filename.includes("doctor")
        ? "Дышите глубже. Хрипов нет."
        : "Я думаю, у меня воспаление лёгких.",
      model: "test",
      durationSec: 20,
    };
  }),
}));

const svc = await import("../../modules/scribe/services/scribe.service.js");
const ScribeSession = (
  await import("../../modules/scribe/models/scribeSession.model.js")
).default;

const oid = () => new mongoose.Types.ObjectId();
const audio = () => Buffer.from("аудио");

describe("согласие на запись приёма", () => {
  let doctorId, patientId;

  beforeEach(() => {
    stt.calls = 0;
    doctorId = oid();
    patientId = oid();
  });

  async function start() {
    return svc.startSession({
      doctorId,
      room: `room-${Date.now()}-${Math.random()}`,
      patientUserId: patientId,
    });
  }

  it("до ответа пациента не пишется НИЧЕГО, включая речь врача", async () => {
    const s = await start();
    expect(s.status).toBe("awaiting_consent");

    const out = await svc.ingestChunk({
      sessionId: s._id,
      userId: doctorId,
      buffer: audio(),
      startSec: 0,
    });

    // Записать половину разговора без согласия второй стороны — то же
    // самое, что записать весь: в кабинете звучит и её голос.
    expect(out.accepted).toBe(false);
    expect(stt.calls).toBe(0);
  });

  it("отказ пациента закрывает сеанс безвозвратно", async () => {
    const s = await start();
    await svc.respondToConsent({
      sessionId: s._id,
      userId: patientId,
      granted: false,
    });

    const after = await ScribeSession.findById(s._id).lean();
    expect(after.status).toBe("declined");

    const out = await svc.ingestChunk({
      sessionId: s._id,
      userId: doctorId,
      buffer: audio(),
      startSec: 0,
    });
    expect(out.accepted).toBe(false);
  });

  it("после согласия обеих сторон куски принимаются", async () => {
    const s = await start();
    await svc.respondToConsent({
      sessionId: s._id,
      userId: patientId,
      granted: true,
    });

    const out = await svc.ingestChunk({
      sessionId: s._id,
      userId: doctorId,
      buffer: audio(),
      startSec: 0,
    });
    expect(out.accepted).toBe(true);
  });

  it("посторонний не может прислать кусок в чужой приём", async () => {
    const s = await start();
    await svc.respondToConsent({
      sessionId: s._id,
      userId: patientId,
      granted: true,
    });

    await expect(
      svc.ingestChunk({
        sessionId: s._id,
        userId: oid(),
        buffer: audio(),
        startSec: 0,
      }),
    ).rejects.toThrow(/не участник/i);
  });

  it("ОТЗЫВ СОГЛАСИЯ ДЕЙСТВУЕТ НАЗАД: сказанное удаляется", async () => {
    const s = await start();
    await svc.respondToConsent({
      sessionId: s._id,
      userId: patientId,
      granted: true,
    });

    await svc.ingestChunk({
      sessionId: s._id,
      userId: doctorId,
      buffer: audio(),
      startSec: 0,
    });
    await svc.ingestChunk({
      sessionId: s._id,
      userId: patientId,
      buffer: audio(),
      startSec: 5,
    });

    await svc.revokeConsent({ sessionId: s._id, userId: patientId });

    const after = await ScribeSession.findById(s._id).lean();
    expect(after.status).toBe("revoked");
    // Реплик пациента не осталось: право прервать, не действующее
    // назад, ничего не стоит.
    expect(after.segments.some((x) => x.speaker === "patient")).toBe(false);
    // Реплики врача остались: его согласия никто не отзывал.
    expect(after.segments.some((x) => x.speaker === "doctor")).toBe(true);
  });

  it("повторный запуск в той же комнате не создаёт второй сеанс", async () => {
    const room = `room-${Date.now()}`;
    await svc.startSession({ doctorId, room, patientUserId: patientId });
    await svc.startSession({ doctorId, room, patientUserId: patientId });

    // Два параллельных сеанса писали бы один разговор дважды и стоили
    // бы вдвое.
    expect(await ScribeSession.countDocuments({ room })).toBe(1);
  });
});

describe("авторство реплик", () => {
  it("реплики хранятся раздельно и упорядочиваются по времени, а не по приходу", async () => {
    const doctorId = oid();
    const patientId = oid();
    const s = await svc.startSession({
      doctorId,
      room: `room-${Date.now()}-order`,
      patientUserId: patientId,
    });
    await svc.respondToConsent({
      sessionId: s._id,
      userId: patientId,
      granted: true,
    });

    // Кусок пациента начался РАНЬШЕ, но пришёл ПОЗЖЕ: два браузера
    // отправляют вперемешку, и порядок приёма к разговору отношения
    // не имеет.
    await svc.ingestChunk({
      sessionId: s._id,
      userId: doctorId,
      buffer: audio(),
      startSec: 20,
    });
    await svc.ingestChunk({
      sessionId: s._id,
      userId: patientId,
      buffer: audio(),
      startSec: 0,
    });

    const fresh = await ScribeSession.findById(s._id);
    const text = svc.dialogueText(fresh);

    // Перепутанный порядок превращает ответ в вопрос.
    expect(text.indexOf("Пациент:")).toBeLessThan(text.indexOf("Врач:"));
    // Каждая реплика подписана: без этого «я думаю, у меня воспаление
    // лёгких» стало бы диагнозом.
    expect(text).toMatch(/^Пациент: /m);
    expect(text).toMatch(/^Врач: /m);
  });
});

describe("поиск сеанса по комнате", () => {
  // Без него модуль не работает вовсе: идентификатор сеанса существует
  // только у врача, а пациент знает лишь комнату. Не найдя сеанс, он
  // никогда не увидит запрос согласия — и врач будет ждать ответа,
  // которого не будет.
  it("участник находит сеанс своей комнаты", async () => {
    const doctorId = oid();
    const patientId = oid();
    const room = `room-lookup-${Date.now()}`;

    await svc.startSession({ doctorId, room, patientUserId: patientId });

    const found = await ScribeSession.findOne({
      room,
      status: { $in: ["awaiting_consent", "recording", "revoked"] },
    }).lean();

    expect(found).toBeTruthy();
    const asPatient = found.participants.find(
      (p) => String(p.userId) === String(patientId),
    );
    expect(asPatient.consent).toBe("pending");
  });

  it("завершённый сеанс по комнате не находится — иначе панель воскресла бы", async () => {
    const doctorId = oid();
    const room = `room-done-${Date.now()}`;
    const s = await svc.startSession({
      doctorId,
      room,
      patientUserId: oid(),
    });
    await ScribeSession.updateOne({ _id: s._id }, { $set: { status: "ready" } });

    const found = await ScribeSession.findOne({
      room,
      status: { $in: ["awaiting_consent", "recording", "revoked"] },
    }).lean();
    expect(found).toBeNull();
  });
});
