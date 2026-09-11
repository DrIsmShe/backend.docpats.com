// __tests__/jobs/doctorVerificationExpiry.test.js
//
// Лестница предупреждений и снятие допуска по сроку.
//
// Главное, что проверяется: письмо о каждой ступени уходит РОВНО ОДИН
// РАЗ. Задание ходит каждую ночь, и без отметки о сказанном письмо «до
// конца срока 30 дней» уходило бы тридцать ночей подряд.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import DoctorProfile from "../../common/models/DoctorProfile/profileDoctor.js";
import Notification from "../../common/models/Notification/notification.js";
import { проверитьСрокиДопуска } from "../../jobs/doctorVerificationExpiry.job.js";

const oid = () => new mongoose.Types.ObjectId();
const через = (дней) => new Date(Date.now() + дней * 86400000);

let счётчик = 0;
async function врач(поля = {}) {
  счётчик += 1;
  return DoctorProfile.create({
    userId: oid(),
    firstName: "Тест",
    lastName: "Врач",
    // Уникальный телефон: phoneHash под уникальным индексом, и два
    // профиля без телефона схлопнулись бы в дубль по null.
    phoneNumber: `+9945055${String(10000 + счётчик).slice(-5)}`,
    verificationStatus: "approved",
    ...поля,
  });
}

const уведомленияДопуска = (userId) =>
  Notification.find({
    userId,
    type: "doctor_verification_expiry",
  }).lean();

describe("лестница предупреждений", () => {
  beforeEach(() => {
    счётчик = 0;
  });

  it("до тридцати дней далеко — не беспокоим", async () => {
    const п = await врач({ verificationExpiresAt: через(60) });
    await проверитьСрокиДопуска();

    const свежий = await DoctorProfile.findById(п._id).lean();
    expect(свежий.verificationExpiryNoticeStage).toBeNull();
    expect(await уведомленияДопуска(п.userId)).toHaveLength(0);
  });

  it("за 25 дней срабатывает ступень 30", async () => {
    const п = await врач({ verificationExpiresAt: через(25) });
    await проверитьСрокиДопуска();

    const свежий = await DoctorProfile.findById(п._id).lean();
    expect(свежий.verificationExpiryNoticeStage).toBe(30);
    // Допуск при этом НЕ трогается: предупреждение — не снятие.
    expect(свежий.verificationStatus).toBe("approved");
    expect(await уведомленияДопуска(п.userId)).toHaveLength(1);
  });

  it("ГЛАВНОЕ: повторный прогон на той же ступени молчит", async () => {
    const п = await врач({ verificationExpiresAt: через(25) });
    await проверитьСрокиДопуска();
    await проверитьСрокиДопуска();
    await проверитьСрокиДопуска();

    expect(await уведомленияДопуска(п.userId)).toHaveLength(1);
  });

  it("следующая ступень говорит заново", async () => {
    // Врач уже предупреждён за 30 дней, теперь до конца 5 дней.
    const п = await врач({
      verificationExpiresAt: через(5),
      verificationExpiryNoticeStage: 30,
    });
    await проверитьСрокиДопуска();

    const свежий = await DoctorProfile.findById(п._id).lean();
    expect(свежий.verificationExpiryNoticeStage).toBe(7);
    expect(await уведомленияДопуска(п.userId)).toHaveLength(1);
  });

  it("бессрочный допуск задание не трогает", async () => {
    const п = await врач({ verificationExpiresAt: null });
    const итог = await проверитьСрокиДопуска();

    expect(итог.проверено).toBe(0);
    expect(await уведомленияДопуска(п.userId)).toHaveLength(0);
  });
});

describe("снятие допуска", () => {
  beforeEach(() => {
    счётчик = 100;
  });

  it("срок вышел — статус expired, isVerified снят", async () => {
    const п = await врач({ verificationExpiresAt: через(-1) });
    const итог = await проверитьСрокиДопуска();

    expect(итог.снято).toBe(1);
    const свежий = await DoctorProfile.findById(п._id).lean();
    // expired, а не rejected: документы не признаны негодными, у них
    // просто вышел срок, и возвращается врач иначе.
    expect(свежий.verificationStatus).toBe("expired");
    expect(свежий.isVerified).toBe(false);
    expect(свежий.verificationExpiryNoticeStage).toBe(0);
  });

  it("снятие тоже не повторяется", async () => {
    const п = await врач({ verificationExpiresAt: через(-3) });
    await проверитьСрокиДопуска();
    const после = await проверитьСрокиДопуска();

    // Второй прогон врача уже не видит: статус больше не approved.
    expect(после.снято).toBe(0);
    expect(await уведомленияДопуска(п.userId)).toHaveLength(1);
  });

  it("продление администратора спасает от снятия", async () => {
    const п = await врач({
      verificationExpiresAt: через(-2), // бумага просрочена
      verificationExtendedUntil: через(40), // но продлено решением
    });
    const итог = await проверитьСрокиДопуска();

    expect(итог.снято).toBe(0);
    const свежий = await DoctorProfile.findById(п._id).lean();
    expect(свежий.verificationStatus).toBe("approved");
    // И до тридцати дней ещё далеко — значит и не предупреждаем.
    expect(свежий.verificationExpiryNoticeStage).toBeNull();
  });
});
