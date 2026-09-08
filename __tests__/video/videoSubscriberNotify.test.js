// Уведомление подписчикам о новом ролике.
//
// Подписка до сих пор ничего не приносила: человек нажимал кнопку и
// узнавал о новом ролике, только если сам заходил в ленту. Проверяем то,
// что делает эту рассылку терпимой: она приходит один раз, только по
// открытым роликам и никогда не срывает саму публикацию.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";

import Video from "../../modules/video/models/video.model.js";
import Notification from "../../common/models/Notification/notification.js";
import VideoSubscription from "../../modules/video/models/videoSubscription.model.js";
import { известитьПодписчиков } from "../../modules/video/services/videoSubscriberNotify.service.js";

const id = () => new mongoose.Types.ObjectId();

async function ролик(поля = {}) {
  return Video.create({
    ownerType: "user",
    ownerId: id(),
    title: "Как готовиться к МРТ",
    lang: "ru",
    kind: "explainer",
    visibility: "public",
    status: "ready",
    phi: false,
    publishedAt: new Date(),
    media: { storageKey: "videos/x.mp4", durationSec: 60, sizeBytes: 100 },
    ...поля,
  });
}

async function подписать(канал, сколько) {
  for (let i = 0; i < сколько; i += 1) {
    await VideoSubscription.create({ subscriberId: id(), ...канал });
  }
}

describe("рассылка подписчикам", () => {
  it("уведомляет каждого подписчика канала", async () => {
    const автор = id();
    const в = await ролик({ ownerId: автор });
    await подписать({ channelType: "user", channelId: автор }, 3);

    const итог = await известитьПодписчиков(в);

    expect(итог.sent).toBe(3);
    const письма = await Notification.find({ type: "video_published" }).lean();
    expect(письма).toHaveLength(3);
    expect(письма[0].link).toBe(`/videos/${в._id}`);
    expect(письма[0].message).toContain("Как готовиться к МРТ");
  });

  it("второй раз молчит", async () => {
    // Снятие с витрины и возврат не должны звонить снова: подписчику
    // сообщают о новом ролике, а не о том, что автор передумал.
    const автор = id();
    const в = await ролик({ ownerId: автор });
    await подписать({ channelType: "user", channelId: автор }, 2);

    await известитьПодписчиков(в);
    const второй = await известитьПодписчиков(в);

    expect(второй.sent).toBe(0);
    expect(await Notification.countDocuments({ type: "video_published" })).toBe(2);
  });

  it("подписчиков клиники берёт по клинике, а не по автору", async () => {
    const clinicId = id();
    const в = await ролик({ clinicId });
    await подписать({ channelType: "clinic", channelId: clinicId }, 2);
    // Подписчик автора-человека к клиническому ролику отношения не имеет.
    await подписать({ channelType: "user", channelId: в.ownerId }, 5);

    const итог = await известитьПодписчиков(в);
    expect(итог.sent).toBe(2);
  });

  it("закрытый ролик рассылки не вызывает", async () => {
    const автор = id();
    const в = await ролик({ ownerId: автор, visibility: "private", publishedAt: null });
    await подписать({ channelType: "user", channelId: автор }, 3);

    expect((await известитьПодписчиков(в)).sent).toBe(0);
    expect(await Notification.countDocuments({})).toBe(0);
  });

  it("ролик с пациентом в кадре рассылки не вызывает", async () => {
    const автор = id();
    const в = await ролик({ ownerId: автор, phi: true, visibility: "private" });
    await подписать({ channelType: "user", channelId: автор }, 3);

    expect((await известитьПодписчиков(в)).sent).toBe(0);
  });

  it("без подписчиков отмечает ролик и молчит дальше", async () => {
    const в = await ролик();

    expect((await известитьПодписчиков(в)).sent).toBe(0);

    const свежий = await Video.findById(в._id).lean();
    expect(свежий.subscribersNotifiedAt).toBeTruthy();
  });

  it("сбой рассылки не выбрасывает наружу", async () => {
    // Публикация уже состоялась; неполученное уведомление — не повод
    // возвращать ролик в черновики.
    const битый = { visibility: "public", phi: false, _id: id(), title: "х" };
    await expect(известитьПодписчиков(битый)).resolves.toEqual({ sent: 0 });
  });
});
