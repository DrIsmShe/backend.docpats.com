// __tests__/scribe/scribeSave.test.js
//
// Сохранение черновика приёма в карту клиники.
//
// Главное здесь — что в карту попадает ТЕКСТ ВРАЧА, а не вывод модели.
// Врач мог всё переписать, и молча сохранить исходный черновик значило
// бы отменить его правки, не сказав ему об этом.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import { runWithTenantContext } from "../../common/context/tenantContext.js";
import ScribeSession from "../../modules/scribe/models/scribeSession.model.js";
import { saveScribeDraft } from "../../modules/scribe/services/scribeSave.service.js";
import newPatientMedicalHistory from "../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";

const oid = () => new mongoose.Types.ObjectId();

function ctx(clinicId, userId) {
  return {
    userId: String(userId),
    clinicId: String(clinicId),
    role: "doctor",
    actorType: "user",
  };
}

async function makeSession(doctorId, over = {}) {
  return ScribeSession.create({
    room: `room-${Date.now()}-${Math.random()}`,
    doctorId,
    status: "ready",
    participants: [
      { userId: doctorId, role: "doctor", consent: "granted" },
      { userId: oid(), role: "patient", consent: "granted" },
    ],
    segments: [
      { speaker: "patient", startSec: 0, text: "Болит голова" },
      { speaker: "doctor", startSec: 10, text: "Хрипов нет" },
    ],
    ...over,
  });
}

describe("сохранение черновика приёма в карту", () => {
  let clinicId, doctorId, patient;

  beforeEach(() => {
    clinicId = oid();
    doctorId = oid();
    patient = { _id: oid() };
  });

  it("сохраняет ПРАВЛЕННЫЙ ВРАЧОМ текст, а не вывод модели", async () => {
    const session = await makeSession(doctorId);

    const encounter = await runWithTenantContext(ctx(clinicId, doctorId), () =>
      saveScribeDraft({
        sessionId: session._id,
        patient,
        body: {
          complaints: "Головная боль, уточнено врачом",
          statusPreasens: "Дыхание везикулярное",
        },
      }),
    );

    expect(encounter.complaints).toBe("Головная боль, уточнено врачом");
    expect(encounter.statusPreasens).toBe("Дыхание везикулярное");
  });

  it("запись создаётся ЧЕРНОВИКОМ — подписывает врач отдельно", async () => {
    const session = await makeSession(doctorId);

    const encounter = await runWithTenantContext(ctx(clinicId, doctorId), () =>
      saveScribeDraft({
        sessionId: session._id,
        patient,
        body: { complaints: "Жалобы" },
      }),
    );

    // Подпись под записью, которую человек не перечитал, обесценивает
    // саму подпись.
    expect(encounter.status).toBe("draft");
    expect(encounter.signedAt).toBeFalsy();
  });

  it("сохранить может только врач, ведший приём", async () => {
    const session = await makeSession(doctorId);
    const someoneElse = oid();

    await expect(
      runWithTenantContext(ctx(clinicId, someoneElse), () =>
        saveScribeDraft({
          sessionId: session._id,
          patient,
          body: { complaints: "чужая запись" },
        }),
      ),
    ).rejects.toThrow(/только врач/i);
  });

  it("повторное сохранение отклоняется — иначе в карте два приёма вместо одного", async () => {
    const session = await makeSession(doctorId);

    await runWithTenantContext(ctx(clinicId, doctorId), () =>
      saveScribeDraft({
        sessionId: session._id,
        patient,
        body: { complaints: "первый раз" },
      }),
    );

    await expect(
      runWithTenantContext(ctx(clinicId, doctorId), () =>
        saveScribeDraft({
          sessionId: session._id,
          patient,
          body: { complaints: "второй раз" },
        }),
      ),
    ).rejects.toThrow(/уже сохранён/i);

    expect(await newPatientMedicalHistory.countDocuments()).toBe(1);
  });

  it("пустые поля не превращаются в выдуманные", async () => {
    const session = await makeSession(doctorId);

    const encounter = await runWithTenantContext(ctx(clinicId, doctorId), () =>
      saveScribeDraft({
        sessionId: session._id,
        patient,
        body: { complaints: "Только жалобы" },
      }),
    );

    // «Поле не заполнено» и «врач написал, что всё в норме» — разные
    // утверждения, и первое честнее.
    expect(encounter.statusPreasens || "").toBe("");
    expect(encounter.mainDiagnosis?.text || "").toBe("");
  });
});
