// __tests__/notifications/preferences.test.js
//
// Настройки уведомлений: чтение и обновление emailDigestEnabled.

import { describe, it, expect } from "vitest";
import User from "../../common/models/Auth/users.js";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from "../../modules/notifications/controllers/preferences.controller.js";
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

describe("notification preferences", () => {
  it("get: по умолчанию emailDigestEnabled=true", async () => {
    const { userId } = await createTestDoctor();
    const res = mockRes();
    await getNotificationPreferences({ userId: String(userId) }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.emailDigestEnabled).toBe(true);
  });

  it("update: выключает и сохраняет в БД", async () => {
    const { userId } = await createTestDoctor();
    const res = mockRes();
    await updateNotificationPreferences(
      { userId: String(userId), body: { emailDigestEnabled: false } },
      res,
    );
    expect(res.body.success).toBe(true);
    const u = await User.findById(userId).select("emailDigestEnabled");
    expect(u.emailDigestEnabled).toBe(false);
  });

  it("update без валидных полей → 400", async () => {
    const { userId } = await createTestDoctor();
    const res = mockRes();
    await updateNotificationPreferences(
      { userId: String(userId), body: {} },
      res,
    );
    expect(res.statusCode).toBe(400);
  });

  it("get без авторизации → 401", async () => {
    const res = mockRes();
    await getNotificationPreferences({}, res);
    expect(res.statusCode).toBe(401);
  });
});

describe("подписка на конференции в настройках", () => {
  it("врачу отдаётся подписка, список категорий и признак доступности", async () => {
    const { userId } = await createTestDoctor();
    const res = mockRes();
    await getNotificationPreferences({ userId: String(userId) }, res);

    expect(res.body.conferenceDigestEnabled).toBe(true);
    expect(res.body.conferenceDigestAvailable).toBe(true);
    expect(res.body.availableConferenceCategories).toHaveLength(14);
    // Пустой список — это «все направления», а не «ни одного»: фронт рисует
    // его как «сейчас все». Значение по умолчанию не должно стать null.
    expect(res.body.conferenceCategories).toEqual([]);
  });

  it("пациенту переключатель не показывается", async () => {
    // Рассылку шлёт jobs/conferenceDigest.job.js только врачам. Показать
    // переключатель пациенту — пообещать письмо, которое не придёт.
    const { userId } = await createTestDoctor({
      role: "patient",
      isDoctor: false,
      isPatient: true,
    });
    const res = mockRes();
    await getNotificationPreferences({ userId: String(userId) }, res);
    expect(res.body.conferenceDigestAvailable).toBe(false);
  });

  it("отписка от конференций не трогает дайджест непрочитанных", async () => {
    const { userId } = await createTestDoctor();
    const res = mockRes();
    await updateNotificationPreferences(
      { userId: String(userId), body: { conferenceDigestEnabled: false } },
      res,
    );
    const u = await User.findById(userId).select(
      "conferenceDigestEnabled emailDigestEnabled",
    );
    expect(u.conferenceDigestEnabled).toBe(false);
    expect(u.emailDigestEnabled).toBe(true);
  });

  it("незнакомые коды категорий отбрасываются, а не роняют сохранение", async () => {
    // Список категорий живёт в двух репозиториях; рассинхрон не должен
    // мешать врачу сохранить настройки.
    const { userId } = await createTestDoctor();
    const res = mockRes();
    await updateNotificationPreferences(
      {
        userId: String(userId),
        body: { conferenceCategories: ["oncology", "выдумка", "surgical", "oncology"] },
      },
      res,
    );
    expect(res.body.success).toBe(true);
    const u = await User.findById(userId).select("conferenceCategories");
    expect(u.conferenceCategories).toEqual(["oncology", "surgical"]);
  });
});
