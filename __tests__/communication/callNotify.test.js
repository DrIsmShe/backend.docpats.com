// __tests__/communication/callNotify.test.js
//
// Уведомления о звонке за пределами открытой вкладки.
//
// До появления callNotify.js звонок существовал только как событие сокета:
// человек с закрытой страницей не узнавал о вызове ни тогда, ни потом.
// Здесь проверяется след, который обязан пережить вкладку, — пропущенный
// звонок в колокольчике, с ссылкой в ЕГО половину сайта.

import { describe, it, expect } from "vitest";
import Notification from "../../common/models/Notification/notification.js";
import { notifyMissedCall } from "../../modules/communication/calls/callNotify.js";
import { createTestDoctor } from "../helpers/createTestUser.js";

describe("уведомления о звонке", () => {
  it("пропущенный звонок ложится в колокольчик со ссылкой в кабинет врача", async () => {
    const doctor = await createTestDoctor();
    const caller = await createTestDoctor();

    await notifyMissedCall(doctor.userId, {
      callerId: caller.userId,
      callerName: "Лямия Исмаил",
      dialogId: "6a4a0eefd4bd0bafe3ab7c81",
    });

    const n = await Notification.findOne({ userId: doctor.userId });
    expect(n).toBeTruthy();
    expect(n.type).toBe("call_missed");
    expect(n.message).toContain("Лямия Исмаил");
    expect(n.link).toBe("/doctor/communication/6a4a0eefd4bd0bafe3ab7c81");
    expect(String(n.senderId)).toBe(String(caller.userId));
  });

  it("пациенту ссылка ведёт в его половину сайта", async () => {
    const patient = await createTestDoctor({ role: "patient", isDoctor: false });

    await notifyMissedCall(patient.userId, {
      callerId: null,
      callerName: "Врач",
      dialogId: "6a4a0eefd4bd0bafe3ab7c81",
    });

    const n = await Notification.findOne({ userId: patient.userId });
    expect(n.link).toBe("/patient/communication/6a4a0eefd4bd0bafe3ab7c81");
  });

  it("два пропущенных подряд — два уведомления, а не одно", async () => {
    const user = await createTestDoctor({ role: "patient", isDoctor: false });
    const caller = await createTestDoctor();

    for (let i = 0; i < 2; i += 1) {
      await notifyMissedCall(user.userId, {
        callerId: caller.userId,
        callerName: "Врач",
        dialogId: "6a4a0eefd4bd0bafe3ab7c81",
      });
    }

    expect(await Notification.countDocuments({ userId: user.userId })).toBe(2);
  });

  it("сбой уведомления не бросает наружу — звонок важнее", async () => {
    await expect(
      notifyMissedCall(null, { callerName: "Никто" }),
    ).resolves.toBeUndefined();
  });
});
