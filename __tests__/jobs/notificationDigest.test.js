// __tests__/jobs/notificationDigest.test.js
//
// Дайджест непрочитанных: кого выбираем (неактивные, с непрочитанными, вне
// cooldown) и что прогон помечает lastDigestEmailAt (анти-спам).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import User from "../../common/models/Auth/users.js";
import { notify } from "../../modules/notifications/services/notification.service.js";
import {
  selectDigestRecipients,
  runNotificationDigest,
} from "../../jobs/notificationDigest.job.js";
import { createTestDoctor } from "../helpers/createTestUser.js";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date();

let savedBrevo;
beforeAll(() => {
  // Гарантируем, что реальные письма НЕ уходят.
  savedBrevo = process.env.BREVO_API_KEY;
  process.env.BREVO_API_KEY = "";
});
afterAll(() => {
  process.env.BREVO_API_KEY = savedBrevo;
});

async function patient(overrides = {}) {
  const { user, userId } = await createTestDoctor({
    role: "patient",
    isDoctor: false,
    isPatient: true,
    ...overrides,
  });
  return { user, userId };
}

async function addUnread(userId, n) {
  for (let i = 0; i < n; i++) {
    await notify({
      userId,
      type: "system_message",
      title: `T${i}`,
      message: `M${i}-${userId}`,
    });
  }
}

describe("notificationDigest — селекция получателей", () => {
  it("выбирает только неактивных с непрочитанными и вне cooldown", async () => {
    const inactive = await patient({
      lastLoginAt: new Date(now.getTime() - 5 * DAY),
    });
    const active = await patient({
      lastLoginAt: new Date(now.getTime() - 1 * 3600_000),
    });
    const digestedRecently = await patient({
      lastLoginAt: new Date(now.getTime() - 5 * DAY),
      lastDigestEmailAt: new Date(now.getTime() - 1 * DAY),
    });
    const noUnread = await patient({
      lastLoginAt: new Date(now.getTime() - 5 * DAY),
    });
    const optedOut = await patient({
      lastLoginAt: new Date(now.getTime() - 5 * DAY),
      emailDigestEnabled: false,
    });

    await addUnread(inactive.userId, 2);
    await addUnread(active.userId, 1);
    await addUnread(digestedRecently.userId, 1);
    await addUnread(optedOut.userId, 3);
    // noUnread — без уведомлений

    const recipients = await selectDigestRecipients(now);
    const ids = recipients.map((r) => String(r.user._id));

    expect(ids).toContain(String(inactive.userId));
    expect(ids).not.toContain(String(active.userId));
    expect(ids).not.toContain(String(digestedRecently.userId));
    expect(ids).not.toContain(String(noUnread.userId));
    expect(ids).not.toContain(String(optedOut.userId)); // опт-аут

    const rec = recipients.find((r) => String(r.user._id) === String(inactive.userId));
    expect(rec.count).toBe(2);
  });

  it("прогон помечает lastDigestEmailAt и второй раз никого не выбирает", async () => {
    const inactive = await patient({
      lastLoginAt: new Date(now.getTime() - 5 * DAY),
    });
    await addUnread(inactive.userId, 1);

    const r1 = await runNotificationDigest(now);
    expect(r1.candidates).toBe(1);

    const after = await User.findById(inactive.userId).select("lastDigestEmailAt");
    expect(after.lastDigestEmailAt).toBeTruthy();

    const r2 = await runNotificationDigest(now);
    expect(r2.candidates).toBe(0); // cooldown сработал
  });
});
