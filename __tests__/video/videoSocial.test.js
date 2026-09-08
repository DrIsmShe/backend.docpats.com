// Отметки и подписки под роликом.
//
// Проверяем то, что ломается тихо и заметно не сразу:
//   • «полезно» и «не помогло» взаимно исключаются — иначе один человек
//     одновременно и за, и против, и обе цифры врут;
//   • подписаться можно только на канал, чей ролик действительно показан;
//   • на себя подписаться нельзя — иначе счётчик доверия накручивается сам;
//   • лента подписок при отсутствии подписок пуста, а не равна каталогу;
//   • лента подписок вместе с поиском не теряет условие поиска ($or против
//     $or — ровно та ошибка, ради которой в сервисе стоит $and).

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";

import Video from "../../modules/video/models/video.model.js";
import VideoSubscription from "../../modules/video/models/videoSubscription.model.js";
import {
  toggleLike,
  toggleDislike,
  listPublicVideos,
  getPublicVideo,
} from "../../modules/video/services/video.service.js";
import {
  toggleSubscription,
  countSubscribers,
  isSubscribed,
} from "../../modules/video/services/videoSubscription.service.js";

const id = () => new mongoose.Types.ObjectId();

function зритель(ownerId = id()) {
  return {
    ownerType: "user",
    ownerId,
    clinicId: null,
    role: null,
    permissions: null,
    email: null,
  };
}

/** Опубликованный ролик — то, что видно в витрине. */
async function опубликованный(поля = {}) {
  return Video.create({
    ownerType: "user",
    ownerId: поля.ownerId || id(),
    clinicId: поля.clinicId || null,
    title: поля.title || "Как готовиться к МРТ",
    lang: "ru",
    kind: "explainer",
    visibility: "public",
    status: "ready",
    phi: false,
    publishedAt: new Date(),
    media: { storageKey: "videos/x.mp4", durationSec: 60, sizeBytes: 1000 },
    ...поля,
  });
}

describe("отметки под роликом", () => {
  it("«полезно» ставится и снимается повторным нажатием", async () => {
    const video = await опубликованный();
    const я = зритель();

    const первое = await toggleLike({ actor: я, id: video._id });
    expect(первое.liked).toBe(true);
    expect(первое.likes).toBe(1);

    const второе = await toggleLike({ actor: я, id: video._id });
    expect(второе.liked).toBe(false);
    expect(второе.likes).toBe(0);
  });

  it("«не помогло» снимает ранее поставленное «полезно»", async () => {
    const video = await опубликованный();
    const я = зритель();

    await toggleLike({ actor: я, id: video._id });
    const итог = await toggleDislike({ actor: я, id: video._id });

    expect(итог.disliked).toBe(true);
    expect(итог.liked).toBe(false);
    expect(итог.likes).toBe(0);
    expect(итог.dislikes).toBe(1);

    // И в базе тоже: интерфейс мог бы показать что угодно, важна запись.
    const свежий = await Video.findById(video._id).lean();
    expect(свежий.likes).toHaveLength(0);
    expect(свежий.dislikes).toHaveLength(1);
  });

  it("и обратно: «полезно» снимает «не помогло»", async () => {
    const video = await опубликованный();
    const я = зритель();

    await toggleDislike({ actor: я, id: video._id });
    const итог = await toggleLike({ actor: я, id: video._id });

    expect(итог.liked).toBe(true);
    expect(итог.disliked).toBe(false);
    expect(итог.dislikes).toBe(0);
  });

  it("отметки разных людей не мешают друг другу", async () => {
    const video = await опубликованный();
    await toggleLike({ actor: зритель(), id: video._id });
    const итог = await toggleLike({ actor: зритель(), id: video._id });

    expect(итог.likes).toBe(2);
  });
});

describe("подписка на канал", () => {
  it("подписка на автора ролика считается и снимается", async () => {
    const автор = id();
    const video = await опубликованный({ ownerId: автор });
    const я = зритель();

    const первое = await toggleSubscription({
      actor: я,
      channelType: "user",
      channelId: String(автор),
    });
    expect(первое.subscribed).toBe(true);
    expect(первое.subscribers).toBe(1);

    expect(
      await isSubscribed({ viewerId: я.ownerId, channelType: "user", channelId: автор }),
    ).toBe(true);

    const второе = await toggleSubscription({
      actor: я,
      channelType: "user",
      channelId: String(автор),
    });
    expect(второе.subscribed).toBe(false);
    expect(второе.subscribers).toBe(0);

    // Ролик тут только чтобы канал существовал.
    expect(video.visibility).toBe("public");
  });

  it("на канал без единого показанного ролика подписаться нельзя", async () => {
    await expect(
      toggleSubscription({
        actor: зритель(),
        channelType: "user",
        channelId: String(id()),
      }),
    ).rejects.toThrow(/не найден/i);
  });

  it("на себя подписаться нельзя", async () => {
    const я = зритель();
    await опубликованный({ ownerId: я.ownerId });

    await expect(
      toggleSubscription({
        actor: я,
        channelType: "user",
        channelId: String(я.ownerId),
      }),
    ).rejects.toThrow(/самого себя/i);
  });

  it("сотрудник клиники подписаться не может — подписывается человек", async () => {
    const автор = id();
    await опубликованный({ ownerId: автор });

    await expect(
      toggleSubscription({
        actor: { ownerType: "employee", ownerId: id(), clinicId: id(), role: "nurse" },
        channelType: "user",
        channelId: String(автор),
      }),
    ).rejects.toThrow();
  });

  it("повторная подписка не удваивает счётчик", async () => {
    const автор = id();
    await опубликованный({ ownerId: автор });
    const я = зритель();

    await toggleSubscription({ actor: я, channelType: "user", channelId: String(автор) });
    // Гонка двух вкладок: та же запись приходит второй раз.
    await VideoSubscription.create({
      subscriberId: я.ownerId,
      channelType: "user",
      channelId: автор,
    }).catch(() => {});

    expect(await countSubscribers({ channelType: "user", channelId: автор })).toBe(1);
  });

  it("карточка ролика отдаёт канал со счётчиком и признаком подписки", async () => {
    const автор = id();
    const video = await опубликованный({ ownerId: автор });
    const я = зритель();
    await toggleSubscription({ actor: я, channelType: "user", channelId: String(автор) });

    const карточка = await getPublicVideo({ id: video._id, viewerId: я.ownerId });
    expect(карточка.channel.type).toBe("user");
    expect(String(карточка.channel.id)).toBe(String(автор));
    expect(карточка.channel.subscribers).toBe(1);
    expect(карточка.channel.subscribedByMe).toBe(true);

    // Гость видит счётчик, но не отмечен подписанным.
    const гостю = await getPublicVideo({ id: video._id, viewerId: null });
    expect(гостю.channel.subscribers).toBe(1);
    expect(гостю.channel.subscribedByMe).toBe(false);
  });
});

describe("лента подписок", () => {
  it("без подписок пуста, а не равна всему каталогу", async () => {
    await опубликованный();
    const я = зритель();

    const { items } = await listPublicVideos({
      query: { feed: "subscriptions" },
      viewer: я,
    });
    expect(items).toHaveLength(0);
  });

  it("гостю ничего не показывает", async () => {
    await опубликованный();
    const { items } = await listPublicVideos({
      query: { feed: "subscriptions" },
      viewer: null,
    });
    expect(items).toHaveLength(0);
  });

  it("показывает только ролики каналов зрителя", async () => {
    const мой = id();
    await опубликованный({ ownerId: мой, title: "Мой канал" });
    await опубликованный({ ownerId: id(), title: "Чужой канал" });

    const я = зритель();
    await toggleSubscription({ actor: я, channelType: "user", channelId: String(мой) });

    const { items } = await listPublicVideos({
      query: { feed: "subscriptions" },
      viewer: я,
    });
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Мой канал");
  });

  it("вместе с поиском не теряет условие поиска", async () => {
    const мой = id();
    await опубликованный({ ownerId: мой, title: "Подготовка к МРТ" });
    await опубликованный({ ownerId: мой, title: "Подготовка к КТ" });

    const я = зритель();
    await toggleSubscription({ actor: я, channelType: "user", channelId: String(мой) });

    const { items } = await listPublicVideos({
      query: { feed: "subscriptions", q: "МРТ" },
      viewer: я,
    });
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Подготовка к МРТ");
  });

  it("подписка на клинику приводит её ролики в ленту", async () => {
    const clinicId = id();
    await опубликованный({ clinicId, title: "Ролик клиники" });
    await опубликованный({ title: "Ролик врача" });

    const я = зритель();
    await toggleSubscription({
      actor: я,
      channelType: "clinic",
      channelId: String(clinicId),
    });

    const { items } = await listPublicVideos({
      query: { feed: "subscriptions" },
      viewer: я,
    });
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Ролик клиники");
  });
});
