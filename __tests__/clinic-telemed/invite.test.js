// server/__tests__/clinic-telemed/invite.test.js
//
// Пациента зовут на видеоприём.
//
// Модуль телемедицины не уведомлял пациента ВООБЩЕ: клиника назначала
// приём, а человек не узнавал о нём никак. Замысел проекта — видеоприём
// только зарегистрированным, и это причина завести аккаунт — не мог
// сработать просто потому, что о приёме никто не сообщал.
//
// Отдельно проверяется, что в письме НЕТ названия приёма. Адрес не
// подтверждён: почту в карту вписал регистратор. Название бывает
// клиническим, и отправлять его на непроверенный адрес — раскрывать
// диагноз постороннему.

import { describe, it, expect, vi, beforeEach } from "vitest";
import mongoose from "mongoose";

const sendEmail = vi.fn(async () => true);
vi.mock("../../common/services/emailService.js", () => ({
  sendEmail: (...a) => sendEmail(...a),
  escapeHtml: (s = "") => String(s),
}));

const { inviteToTelemedSession } = await import(
  "../../modules/clinic/clinic-telemed/services/telemedInvite.service.js"
);
const { default: ClinicPatient, hashValue } = await import(
  "../../modules/clinic/clinic-patients/models/clinicPatient.model.js"
);
const { default: Notification } = await import(
  "../../common/models/Notification/notification.js"
);
const { default: Clinic } = await import(
  "../../modules/clinic/clinic-core/models/clinic.model.js"
);
const { encryptPHI } = await import("../../common/utils/phiCrypto.js");

const oid = () => new mongoose.Types.ObjectId();

async function makeClinic(name = "Медцентр Север") {
  const c = await Clinic.create({
    name,
    ownerId: oid(),
    defaultLanguage: "ru",
  });
  return c._id;
}

const session = (over = {}) => ({
  _id: oid(),
  clinicId: over.clinicId || oid(),
  scheduledAt: new Date("2026-09-10T09:00:00.000Z"),
  title: "Консультация онколога",
  ...over,
});

beforeEach(() => sendEmail.mockClear());

describe("приглашение на видеоприём", () => {
  it("пациенту с аккаунтом — уведомление в кабинет, без письма", async () => {
    const userId = oid();
    const clinicId = await makeClinic();

    const res = await inviteToTelemedSession(
      session({ clinicId, patientUserId: userId }),
    );

    expect(res.via).toBe("app");
    expect(sendEmail).not.toHaveBeenCalled();
    const n = await Notification.findOne({ userId }).lean();
    expect(n.link).toBe("/patient/telemed");
    expect(n.i18n.title).toBe("app.notify.telemedScheduled.title");
  });

  it("карта связана с аккаунтом — тоже уведомление, а не письмо", async () => {
    const userId = oid();
    const clinicId = await makeClinic();
    const card = await ClinicPatient.create({
      clinicId,
      firstNameEncrypted: "enc:И",
      lastNameEncrypted: "enc:И",
      linkedUserId: userId,
      createdBy: oid(),
      createdByType: "user",
    });

    const res = await inviteToTelemedSession(
      session({ clinicId, patientId: card._id }),
    );

    expect(res.via).toBe("app");
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await Notification.countDocuments({ userId })).toBe(1);
  });

  it("аккаунта нет — письмо на адрес из карты", async () => {
    const clinicId = await makeClinic("Клиника Юг");
    const card = await ClinicPatient.create({
      clinicId,
      firstNameEncrypted: "enc:И",
      lastNameEncrypted: "enc:И",
      emailEncrypted: encryptPHI("newcomer@example.com"),
      emailHash: hashValue("newcomer@example.com"),
      createdBy: oid(),
      createdByType: "user",
    });

    const res = await inviteToTelemedSession(
      session({ clinicId, patientId: card._id }),
    );

    expect(res.via).toBe("email");
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [to, subject, body] = sendEmail.mock.calls[0];
    expect(to).toBe("newcomer@example.com");
    expect(subject).toContain("видеоприём");
    // Название клиники нужно: без него письмо выглядит как спам.
    expect(body).toContain("Клиника Юг");
    // А приглашение регистрироваться — это и есть весь смысл письма.
    expect(body).toContain("/registration");
  });

  it("в письме нет названия приёма — адрес не подтверждён", async () => {
    const clinicId = await makeClinic();
    const card = await ClinicPatient.create({
      clinicId,
      firstNameEncrypted: "enc:И",
      lastNameEncrypted: "enc:И",
      emailEncrypted: encryptPHI("private@example.com"),
      createdBy: oid(),
      createdByType: "user",
    });

    await inviteToTelemedSession(
      session({ clinicId, patientId: card._id, title: "Консультация онколога" }),
    );

    const [, subject, body] = sendEmail.mock.calls[0];
    expect(body).not.toContain("онколог");
    expect(subject).not.toContain("онколог");
  });

  it("ни аккаунта, ни почты — никого не беспокоим", async () => {
    const clinicId = await makeClinic();
    const card = await ClinicPatient.create({
      clinicId,
      firstNameEncrypted: "enc:И",
      lastNameEncrypted: "enc:И",
      createdBy: oid(),
      createdByType: "user",
    });

    const res = await inviteToTelemedSession(
      session({ clinicId, patientId: card._id }),
    );
    expect(res.via).toBe("none");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("сбой приглашения не бросает наружу", async () => {
    sendEmail.mockRejectedValueOnce(new Error("SMTP лёг"));
    const clinicId = await makeClinic();
    const card = await ClinicPatient.create({
      clinicId,
      firstNameEncrypted: "enc:И",
      lastNameEncrypted: "enc:И",
      emailEncrypted: encryptPHI("fail@example.com"),
      createdBy: oid(),
      createdByType: "user",
    });

    // Приём уже создан — исключение отсюда отменило бы его задним числом.
    await expect(
      inviteToTelemedSession(session({ clinicId, patientId: card._id })),
    ).resolves.toEqual({ via: "none" });
  });
});
