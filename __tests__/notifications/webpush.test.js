// __tests__/notifications/webpush.test.js
//
// Web-push: подписки (upsert/remove), безопасный sendToUser, и что push-хук
// не ломает создание уведомления.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import PushSubscription from "../../common/models/Notification/pushSubscription.js";
import {
  saveSubscription,
  removeSubscription,
  sendToUser,
} from "../../modules/notifications/services/webpush.service.js";
import { notify } from "../../modules/notifications/services/notification.service.js";

const oid = () => new mongoose.Types.ObjectId();
const fakeSub = (endpoint) => ({
  endpoint,
  keys: { p256dh: "p256dh-key", auth: "auth-key" },
});

describe("web-push подписки", () => {
  it("saveSubscription — upsert по endpoint (одна запись, обновляет UA)", async () => {
    const userId = oid();
    const ep = "https://push.example.com/ep-1";
    await saveSubscription(userId, fakeSub(ep), "UA/1");
    await saveSubscription(userId, fakeSub(ep), "UA/2");
    const docs = await PushSubscription.find({ endpoint: ep });
    expect(docs.length).toBe(1);
    expect(docs[0].userAgent).toBe("UA/2");
  });

  it("saveSubscription отклоняет некорректную подписку", async () => {
    await expect(saveSubscription(oid(), { endpoint: "x" })).rejects.toThrow();
  });

  it("removeSubscription удаляет по endpoint", async () => {
    const ep = "https://push.example.com/ep-2";
    await saveSubscription(oid(), fakeSub(ep));
    await removeSubscription(ep);
    expect(await PushSubscription.countDocuments({ endpoint: ep })).toBe(0);
  });

  it("sendToUser без подписок → 0, не бросает", async () => {
    const sent = await sendToUser(oid(), { title: "t", body: "b" });
    expect(sent).toBe(0);
  });

  it("notify() создаёт уведомление и не падает из-за push-хука", async () => {
    const userId = oid();
    const doc = await notify({
      userId,
      type: "system_message",
      title: "Привет",
      message: "Тест",
    });
    expect(doc).toBeTruthy();
    expect(String(doc.userId)).toBe(String(userId));
    expect(doc.title).toBe("Привет");
  });
});
