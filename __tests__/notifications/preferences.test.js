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
