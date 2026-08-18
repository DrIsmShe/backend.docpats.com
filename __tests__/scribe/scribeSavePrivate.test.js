// __tests__/scribe/scribeSavePrivate.test.js
//
// Сохранение черновика приёма в карту ЧАСТНОГО врача.
//
// Проверка владения здесь важнее, чем в клинике, и это не фигура речи.
// В клинике доступ ограничен арендатором: чужая карта просто не видна.
// У частного врача арендатора нет — единственное, что отделяет его
// запись от чужой карты, это сравнение владельца. Без него врач мог бы
// дописать запись в карту чужого пациента, зная её идентификатор.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import ScribeSession from "../../modules/scribe/models/scribeSession.model.js";
import NewPatientPolyclinic from "../../common/models/Polyclinic/newPatientPolyclinic.js";
import DoctorPrivatePatient from "../../common/models/Polyclinic/DoctorPrivatePatient.js";
import newPatientMedicalHistory from "../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";
import {
  saveScribeDraftPrivate,
  findPrivatePatientByUser,
} from "../../modules/scribe/services/scribeSavePrivate.service.js";

const oid = () => new mongoose.Types.ObjectId();

/**
 * Пациент поликлиники. Модель требует набор обязательных полей —
 * собираем их в одном месте, иначе шесть копий разойдутся при первой же
 * правке схемы.
 */
let seq = 0;
function polyPatient(over = {}) {
  seq += 1;
  return {
    patientId: `P-${Date.now()}-${seq}`,
    patientType: "registered",
    identityDocument: `ID-${seq}`,
    birthDate: new Date("1990-01-01"),
    firstNameEncrypted: "a",
    lastNameEncrypted: "b",
    emailEncrypted: `e${seq}`,
    emailHash: `h${seq}`,
    ...over,
  };
}

/**
 * Создать пациента поликлиники.
 *
 * Модель намеренно запрещает прямое создание без $locals.allowCreate —
 * защита от случайной записи мимо сервиса. В тесте флаг ставим явно:
 * проверяем сохранение приёма, а не путь заведения пациента.
 */
async function createPoly(over = {}) {
  const doc = new NewPatientPolyclinic(polyPatient(over));
  doc.$locals.allowCreate = true;
  await doc.save();
  return doc;
}

async function makeSession(doctorId) {
  return ScribeSession.create({
    room: `room-${Date.now()}-${Math.random()}`,
    doctorId,
    status: "ready",
    participants: [
      { userId: doctorId, role: "doctor", consent: "granted" },
      { userId: oid(), role: "patient", consent: "granted" },
    ],
    segments: [{ speaker: "doctor", startSec: 0, text: "Осмотр" }],
  });
}

describe("сохранение в карту частной практики", () => {
  let doctorId;

  beforeEach(() => {
    doctorId = oid();
  });

  it("сохраняет черновиком и БЕЗ клиники", async () => {
    const patient = await createPoly({ doctorId: [doctorId] });
    const session = await makeSession(doctorId);

    const doc = await saveScribeDraftPrivate({
      sessionId: session._id,
      doctorId,
      patientRef: patient._id,
      patientTypeModel: "NewPatientPolyclinic",
      body: { complaints: "Головная боль" },
    });

    expect(doc.status).toBe("draft");
    expect(doc.complaints).toBe("Головная боль");
    // Клиники в записи частной практики быть не должно: приписать ей
    // арендатора значило бы сделать её видимой не тем.
    expect(doc.createdByClinicId).toBeFalsy();
    expect(String(doc.createdBy)).toBe(String(doctorId));
  });

  it("ЧУЖОГО пациента не принимает", async () => {
    const strangersPatient = await createPoly({ doctorId: [oid()] }) // другой врач;
    const session = await makeSession(doctorId);

    await expect(
      saveScribeDraftPrivate({
        sessionId: session._id,
        doctorId,
        patientRef: strangersPatient._id,
        patientTypeModel: "NewPatientPolyclinic",
        body: { complaints: "чужая карта" },
      }),
    ).rejects.toThrow(/не ваш пациент/i);

    expect(await newPatientMedicalHistory.countDocuments()).toBe(0);
  });

  it("пациента ведут несколько врачей — записать вправе любой из них", async () => {
    const colleague = oid();
    const patient = await createPoly({ doctorId: [colleague, doctorId] });
    const session = await makeSession(doctorId);

    const doc = await saveScribeDraftPrivate({
      sessionId: session._id,
      doctorId,
      patientRef: patient._id,
      patientTypeModel: "NewPatientPolyclinic",
      body: { complaints: "Совместное ведение" },
    });
    expect(doc).toBeTruthy();
  });

  it("частный пациент проверяется по создателю, а не по списку", async () => {
    const priv = await DoctorPrivatePatient.create({
      createdBy: doctorId,
      doctorProfileId: oid(),
      firstName: "Иван",
      lastName: "Петров",
    });
    const session = await makeSession(doctorId);

    const doc = await saveScribeDraftPrivate({
      sessionId: session._id,
      doctorId,
      patientRef: priv._id,
      patientTypeModel: "DoctorPrivatePatient",
      body: { complaints: "Приём" },
    });
    expect(doc.patientTypeModel).toBe("DoctorPrivatePatient");
  });

  it("повторное сохранение отклоняется", async () => {
    const patient = await createPoly({ doctorId: [doctorId] });
    const session = await makeSession(doctorId);

    await saveScribeDraftPrivate({
      sessionId: session._id,
      doctorId,
      patientRef: patient._id,
      patientTypeModel: "NewPatientPolyclinic",
      body: { complaints: "первый раз" },
    });

    await expect(
      saveScribeDraftPrivate({
        sessionId: session._id,
        doctorId,
        patientRef: patient._id,
        patientTypeModel: "NewPatientPolyclinic",
        body: { complaints: "второй раз" },
      }),
    ).rejects.toThrow(/уже сохранён/i);
  });

  it("сохранить может только врач, ведший приём", async () => {
    const patient = await createPoly({ doctorId: [doctorId] });
    const session = await makeSession(doctorId);

    await expect(
      saveScribeDraftPrivate({
        sessionId: session._id,
        doctorId: oid(),
        patientRef: patient._id,
        patientTypeModel: "NewPatientPolyclinic",
        body: {},
      }),
    ).rejects.toThrow(/только врач/i);
  });
});

describe("поиск карты частного врача", () => {
  it("карта чужого пациента не находится, своя — находится", async () => {
    const me = oid();
    const stranger = oid();
    const patientUser = oid();

    // У пациента поликлиники ОДНА карта на всех врачей: linkedUserId
    // уникален, а лечащие врачи перечислены списком внутри неё. Значит
    // «чужой пациент» — это не другая карта, а та же самая, в списке
    // которой нашего врача нет.
    const card = await createPoly({
      doctorId: [stranger],
      linkedUserId: patientUser,
    });

    expect(
      await findPrivatePatientByUser({ doctorId: me, userId: patientUser }),
    ).toBeNull();

    // Врача добавили к пациенту — карта стала его.
    await NewPatientPolyclinic.updateOne(
      { _id: card._id },
      { $push: { doctorId: me } },
    );

    const found = await findPrivatePatientByUser({
      doctorId: me,
      userId: patientUser,
    });
    expect(found.patientTypeModel).toBe("NewPatientPolyclinic");
    expect(String(found.id)).toBe(String(card._id));
  });
});
