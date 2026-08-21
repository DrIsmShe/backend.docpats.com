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

const stt = { calls: 0, langs: [] };
vi.mock("../../modules/dictation/providers/stt.provider.js", () => ({
  transcribe: vi.fn(async ({ filename, lang }) => {
    stt.calls += 1;
    stt.langs.push(lang ?? null);
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
    stt.langs = [];
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

describe("карта пациента из телемед-приёма", () => {
  // У назначенного приёма карта известна ЗАРАНЕЕ. Искать её потом по
  // аккаунту незачем и вредно: поиск может не найти (карта не связана с
  // аккаунтом, пациент в клинике впервые), и врач упрётся в тупик с уже
  // записанным разговором.
  it("берёт карту и пациента из сеанса, а не из запроса", async () => {
    const TelemedSession = (
      await import(
        "../../modules/clinic/clinic-telemed/models/telemedSession.model.js"
      )
    ).default;
    const ClinicPatient = (
      await import(
        "../../modules/clinic/clinic-patients/models/clinicPatient.model.js"
      )
    ).default;

    const clinicId = oid();
    const patientUser = oid();

    const card = await ClinicPatient.create({
      clinicId,
      firstNameEncrypted: "x",
      lastNameEncrypted: "y",
      linkedUserId: patientUser,
      createdBy: oid(),
      createdByType: "user",
    });

    const tele = await TelemedSession.create({
      clinicId,
      patientId: card._id,
      joinKey: `k-${Date.now()}`,
      title: "Консультация",
      scheduledAt: new Date(),
    });

    const s = await svc.startSession({
      doctorId: oid(),
      room: `telemed-${tele._id}`,
      // Пациента НЕ передаём: его должен определить сам приём.
      patientUserId: null,
      telemedSessionId: tele._id,
    });

    expect(String(s.patientRef)).toBe(String(card._id));
    expect(s.patientTypeModel).toBe("ClinicPatient");
    const patient = s.participants.find((p) => p.role === "patient");
    expect(String(patient.userId)).toBe(String(patientUser));
  });
});

// ── Язык приёма ──────────────────────────────────────────────────────────────
//
// Врач называет язык ДО начала записи, и язык хранится в сеансе, а не берётся
// каждой стороной из своего браузера. Иначе половина приёма распознавалась бы
// не на том языке: у врача интерфейс на русском, у пациента на азербайджанском.
//
// Цена ошибки здесь не «немного неточно»: на неверном языке распознаватель
// выдаёт связную чушь — азербайджанская речь возвращалась русской
// транслитерацией, похожей на текст ровно настолько, чтобы сойти за расшифровку.
describe("язык приёма", () => {
  let doctorId, patientId;

  beforeEach(() => {
    stt.calls = 0;
    stt.langs = [];
    doctorId = oid();
    patientId = oid();
  });

  async function recordingSession(lang) {
    const s = await svc.startSession({
      doctorId,
      room: `room-${Date.now()}-${Math.random()}`,
      patientUserId: patientId,
      lang,
    });
    await svc.respondToConsent({
      sessionId: s._id,
      userId: patientId,
      granted: true,
    });
    return s;
  }

  it("сохраняется в сеансе при его создании", async () => {
    const s = await recordingSession("az");
    expect(s.lang).toBe("az");
  });

  it("уходит в распознавание для обеих сторон", async () => {
    const s = await recordingSession("az");

    await svc.ingestChunk({ sessionId: s._id, userId: doctorId, buffer: audio(), startSec: 0 });
    await svc.ingestChunk({ sessionId: s._id, userId: patientId, buffer: audio(), startSec: 5 });

    expect(stt.langs).toEqual(["az", "az"]);
  });

  it("язык сеанса перебивает язык из запроса", async () => {
    const s = await recordingSession("az");

    // Браузер пациента о выборе врача не знает и присылает свой язык.
    await svc.ingestChunk({
      sessionId: s._id,
      userId: patientId,
      buffer: audio(),
      startSec: 0,
      lang: "ru",
    });

    expect(stt.langs).toEqual(["az"]);
  });

  it("без выбора язык не навязывается — распознаватель определит сам", async () => {
    const s = await recordingSession("");
    await svc.ingestChunk({ sessionId: s._id, userId: doctorId, buffer: audio(), startSec: 0 });
    expect(stt.langs).toEqual([""]);
  });
});

// ── Устройство не может писать ───────────────────────────────────────────────
//
// На телефоне микрофон занят звонком, и второй захват мобильные браузеры не
// делят, а передают: нажатие «Вести запись приёма» оставляло консультацию без
// звука. Поэтому телефон честно сообщает, что писать не может.
//
// Отдельно от отказа, и это не формальность: отказ — решение человека и
// закрывает сеанс безвозвратно. Записать его там, где человек ничего не
// решал, значит подделать запись о согласии.
describe("устройство не может писать", () => {
  let doctorId, patientId;

  beforeEach(() => {
    stt.calls = 0;
    stt.langs = [];
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

  it("помечает участника, не трогая статус сеанса", async () => {
    const s = await start();
    await svc.markRecordingUnsupported({ sessionId: s._id, userId: patientId });

    const after = await ScribeSession.findById(s._id).lean();
    const patient = after.participants.find((p) => p.role === "patient");
    expect(patient.consent).toBe("unsupported");
    // Не declined: сеанс не закрыт, человек ничего не отклонял.
    expect(after.status).toBe("awaiting_consent");
  });

  it("куски не принимаются — записывать всё равно нечего", async () => {
    const s = await start();
    await svc.markRecordingUnsupported({ sessionId: s._id, userId: patientId });

    const out = await svc.ingestChunk({
      sessionId: s._id,
      userId: doctorId,
      buffer: audio(),
      startSec: 0,
    });
    expect(out.accepted).toBe(false);
    expect(stt.calls).toBe(0);
  });

  it("не перебивает уже данное согласие", async () => {
    const s = await start();
    await svc.respondToConsent({
      sessionId: s._id,
      userId: patientId,
      granted: true,
    });

    // Тот же человек открыл комнату с телефона — согласие, данное с
    // компьютера, отменять нельзя.
    await svc.markRecordingUnsupported({ sessionId: s._id, userId: patientId });

    const after = await ScribeSession.findById(s._id).lean();
    const patient = after.participants.find((p) => p.role === "patient");
    expect(patient.consent).toBe("granted");
    expect(after.status).toBe("recording");
  });

  it("посторонний пометить чужой сеанс не может", async () => {
    const s = await start();
    await expect(
      svc.markRecordingUnsupported({ sessionId: s._id, userId: oid() }),
    ).rejects.toThrow(/не участник/i);
  });

  // Комната у диалога одна на все звонки за всё время (dialog-<id>).
  // Пациент, подключившийся утром с телефона, оставлял сеанс висеть в
  // awaiting_consent с «устройство не умеет» — и следующий звонок из
  // этого диалога получал его назад. Запись становилась невозможной
  // навсегда: врач видел приговор, вынесенный прошлому разговору, а
  // нового сеанса startSession не заводил.
  it("сеанс с неспособным устройством не выдаётся следующему звонку", async () => {
    const room = `room-${Date.now()}-${Math.random()}`;
    const first = await svc.startSession({
      doctorId,
      room,
      patientUserId: patientId,
    });
    await svc.markRecordingUnsupported({
      sessionId: first._id,
      userId: patientId,
    });

    // Пациент пересел за компьютер и перезвонил.
    const second = await svc.startSession({
      doctorId,
      room,
      patientUserId: patientId,
    });

    expect(String(second._id)).not.toBe(String(first._id));
    const patient = second.participants.find((p) => p.role === "patient");
    expect(patient.consent).toBe("pending");
  });
});

describe("сеанс живёт не дольше приёма", () => {
  // Приём длиннее MAX_SESSION_SEC не бывает — дальше куски не
  // принимаются. Значит сеанс старше этой границы к текущему разговору
  // отношения не имеет, и подставлять его новому звонку нельзя.
  it("вчерашний недоотвеченный сеанс не переиспользуется", async () => {
    const doctorId = oid();
    const patientId = oid();
    const room = `room-${Date.now()}-${Math.random()}`;

    const stale = await svc.startSession({
      doctorId,
      room,
      patientUserId: patientId,
    });

    // Отматываем создание за границу: сеанс заведомо не может идти.
    // Через драйвер, а не через модель: createdAt у Mongoose immutable,
    // и $set по нему молча отбрасывается — тест «проходил» бы, ничего
    // не проверив.
    await ScribeSession.collection.updateOne(
      { _id: stale._id },
      {
        $set: {
          createdAt: new Date(Date.now() - (svc.MAX_SESSION_SEC + 60) * 1000),
        },
      },
    );

    const fresh = await svc.startSession({
      doctorId,
      room,
      patientUserId: patientId,
    });

    expect(String(fresh._id)).not.toBe(String(stale._id));
    expect(fresh.status).toBe("awaiting_consent");
  });

  it("идущий сеанс переиспользуется, а не дублируется", async () => {
    const doctorId = oid();
    const patientId = oid();
    const room = `room-${Date.now()}-${Math.random()}`;

    const first = await svc.startSession({
      doctorId,
      room,
      patientUserId: patientId,
    });
    const again = await svc.startSession({
      doctorId,
      room,
      patientUserId: patientId,
    });

    expect(String(again._id)).toBe(String(first._id));
  });
});
