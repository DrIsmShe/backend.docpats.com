// Пакеты минут: начисление складывается и оставляет след в реестре.
//
// Проверяем то, из-за чего финансовые отчёты и разъезжаются: что второй
// пакет прибавляется к первому, а не заменяет его, и что каждое начисление
// видно в реестре транзакций — иначе через полгода минуты выглядят как
// взявшиеся из ниоткуда.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";

import User from "../../common/models/Auth/users.js";
import PaymentTransaction from "../../modules/payments/models/paymentTransaction.js";
import { grantMinutes, videoQuota } from "../../modules/video/services/videoQuota.service.js";
import { VIDEO_MINUTE_PACKS } from "../../common/config/aiPlanLimits.js";
import { createTestDoctor } from "../helpers/createTestUser.js";

// Пользователя заводим общей фабрикой: модель требует зашифрованные поля и
// их хеши, которые mongoose проверяет ДО pre-save хуков.
async function пользователь(plan = "doctor_free") {
  const { user } = await createTestDoctor({ subscriptionPlan: plan });
  return user;
}

describe("пакеты минут", () => {
  it("в каталоге есть два пакета с ценой и минутами", () => {
    expect(Object.keys(VIDEO_MINUTE_PACKS)).toHaveLength(2);
    for (const пакет of Object.values(VIDEO_MINUTE_PACKS)) {
      expect(пакет.minutes).toBeGreaterThan(0);
      expect(пакет.price).toBeGreaterThan(0);
    }
  });

  it("начисление складывается, а не заменяет", async () => {
    const user = await пользователь();

    await grantMinutes({ userId: user._id, minutes: 30, reason: "пакет 1", paid: 12 });
    const итог = await grantMinutes({
      userId: user._id,
      minutes: 120,
      reason: "пакет 2",
      paid: 39,
    });

    expect(итог.minutesTotal).toBe(150);
    const свежий = await User.findById(user._id).select("videoRenderMinutesAddon");
    expect(свежий.videoRenderMinutesAddon).toBe(150);
  });

  it("каждое начисление видно в реестре транзакций", async () => {
    const user = await пользователь();
    await grantMinutes({ userId: user._id, minutes: 30, reason: "покупка", paid: 12 });

    const записи = await PaymentTransaction.find({ userId: user._id }).lean();
    expect(записи).toHaveLength(1);
    expect(записи[0].amount).toBe(12);
    expect(записи[0].status).toBe("paid");
    expect(записи[0].meta.purpose).toBe("video_minutes");
    expect(записи[0].meta.minutes).toBe(30);
  });

  it("докупленные минуты поднимают предел тарифа", async () => {
    const user = await пользователь();
    await grantMinutes({ userId: user._id, minutes: 30, reason: "пакет", paid: 12 });

    const свежий = await User.findById(user._id).lean();
    const квота = await videoQuota({ user: свежий, ownerId: user._id });

    // 6 минут по бесплатному плану плюс купленные 30.
    expect(квота.renderLimit).toBe(36);
  });

  it("нулевое начисление отклоняется", async () => {
    const user = await пользователь();
    await expect(
      grantMinutes({ userId: user._id, minutes: 0, reason: "пусто" }),
    ).rejects.toThrow(/нечего начислять/i);
  });
});
