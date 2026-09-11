// __tests__/admin/verificationQueue.test.js
//
// Очередь верификации показывает ТЕ документы, которые прислал врач.
//
// До этой правки очередь читала profile.verificationDocuments — массив
// адресов на самом профиле, куда врач не пишет ничего: его загрузки идут
// в коллекцию DoctorVerificationDocument. У каждого врача стояло
// «документы не приложены», и администратор решал вслепую.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import DoctorProfile from "../../common/models/DoctorProfile/profileDoctor.js";
import DoctorVerificationDocument from "../../common/models/DoctorVerification/DocumentFiles.js";
import { verificationQueue } from "../../modules/admin/controllers/adminEntities.controller.js";

const oid = () => new mongoose.Types.ObjectId();
const через = (дней) => new Date(Date.now() + дней * 86400000);

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

const mockReq = () => ({
  userId: String(oid()),
  session: {},
  ip: "127.0.0.1",
  get: () => "test",
});

let счётчик = 0;
async function врач(поля = {}) {
  счётчик += 1;
  return DoctorProfile.create({
    userId: oid(),
    firstName: "Тест",
    lastName: "Врач",
    // Виртуал называется phoneNumber, а не phone: «phone» схемой не
    // объявлен вовсе и в строгом режиме молча отбрасывается, а
    // phoneHash остаётся null — и два профиля схлопываются по нему в
    // дубль, потому что sparse-индекс явный null всё равно индексирует.
    phoneNumber: `+9945044${String(10000 + счётчик).slice(-5)}`,
    verificationStatus: "pending",
    ...поля,
  });
}

async function документ(профиль, documentType, поля = {}) {
  return DoctorVerificationDocument.create({
    doctorProfileId: профиль._id,
    userId: профиль.userId,
    documentType,
    fileUrl: `https://example.test/${documentType}.pdf`,
    status: "approved",
    ...поля,
  });
}

async function очередь() {
  const res = mockRes();
  await verificationQueue(mockReq(), res);
  return res.body;
}

describe("очередь верификации", () => {
  it("ГЛАВНОЕ: показывает документы из коллекции врача, а не пустоту", async () => {
    const п = await врач();
    await документ(п, "license", {
      documentNumber: "AZ-12345",
      issuingAuthority: "Səhiyyə Nazirliyi",
      jurisdictionCode: "AZ",
      expiresAt: через(400),
      expiryConfirmed: true,
    });
    await документ(п, "diploma");

    const { queue } = await очередь();
    const карточка = queue.find((к) => к.profileId === String(п._id));

    expect(карточка.documentsCount).toBe(2);
    expect(карточка.documents).toHaveLength(2);

    const лицензия = карточка.documents.find((д) => д.type === "license");
    expect(лицензия.number).toBe("AZ-12345");
    expect(лицензия.jurisdiction).toBe("AZ");
    expect(лицензия.expiryConfirmed).toBe(true);
    expect(лицензия.url).toContain("license.pdf");
  });

  it("показывает, чего не хватает до полного набора", async () => {
    const п = await врач();
    await документ(п, "license");
    await документ(п, "diploma");

    const { queue } = await очередь();
    const карточка = queue.find((к) => к.profileId === String(п._id));

    // Осталось два вида: специализация и удостоверение личности.
    expect(карточка.missing).toEqual(["specialization", "passport|id_card"]);
  });

  it("полный набор — нехватки нет", async () => {
    const п = await врач();
    for (const вид of ["license", "diploma", "specialization", "id_card"]) {
      await документ(п, вид);
    }

    const { queue } = await очередь();
    const карточка = queue.find((к) => к.profileId === String(п._id));
    expect(карточка.missing).toEqual([]);
  });

  it("документ на проверке засчитывается как одобренный", async () => {
    // Администратор смотрит очередь именно затем, чтобы его одобрить:
    // список «чего не хватает» должен показывать, чего НЕТ ВООБЩЕ.
    const п = await врач();
    for (const вид of ["license", "diploma", "specialization", "passport"]) {
      await документ(п, вид, { status: "pending" });
    }

    const { queue } = await очередь();
    const карточка = queue.find((к) => к.profileId === String(п._id));
    expect(карточка.missing).toEqual([]);
  });

  it("истёкшие и приостановленные тоже в очереди — это работа админа", async () => {
    const истёк = await врач({
      verificationStatus: "expired",
      verificationExpiresAt: через(-3),
    });
    const снят = await врач({ verificationStatus: "suspended" });

    const { queue } = await очередь();
    const ключи = new Set(queue.map((к) => к.profileId));

    expect(ключи.has(String(истёк._id))).toBe(true);
    expect(ключи.has(String(снят._id))).toBe(true);

    const карточка = queue.find((к) => к.profileId === String(истёк._id));
    expect(карточка.status).toBe("expired");
    expect(карточка.accessExpiresAt).toBeTruthy();
  });

  it("одобренный врач в очереди не висит", async () => {
    const п = await врач({ verificationStatus: "approved" });
    const { queue } = await очередь();
    expect(queue.some((к) => к.profileId === String(п._id))).toBe(false);
  });

  it("срок допуска в карточке учитывает продление администратора", async () => {
    const п = await врач({
      verificationStatus: "expired",
      verificationExpiresAt: через(-10),
      verificationExtendedUntil: через(20),
    });

    const { queue } = await очередь();
    const карточка = queue.find((к) => к.profileId === String(п._id));

    // Показывается позднейшая из двух дат — иначе администратор видел бы
    // «просрочен» у врача, которого сам же продлил.
    expect(new Date(карточка.accessExpiresAt).getTime()).toBe(
      new Date(п.verificationExtendedUntil).getTime(),
    );
  });
});
